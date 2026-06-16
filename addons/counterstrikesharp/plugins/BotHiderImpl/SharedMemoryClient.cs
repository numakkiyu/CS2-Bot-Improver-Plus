using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using BotHiderApi;

namespace BotHiderImpl;

// Reads BotHider's shared-memory data region and posts write commands
// src/slot_shm.h
public sealed class SharedMemoryClient : IBotHiderApi, IDisposable
{
    private const string MappingName = "CS2BotHider_Slots";
    private const string PosixMappingPath = "/dev/shm/CS2BotHider_Slots";
    private const uint Magic = 0x44494842; // 'BHID'
    private const int MaxSlots = 64;
    private const int NameLen = 32;
    private const int CmdCount = 64;
    private const int TotalSize = 16384;

    // Data region offsets
    private const int OffMagic = 0;
    private const int OffSlotState = 16;
    private const int OffSyntheticSid = 80;
    private const int OffPersonaName = 592;
    // Extra data region
    private const int OffCurrentPing = 5720;  // int32[64]
    private const int OffCrosshair = 5976;  // char[64][64]
    private const int CrosshairLen = 64;

    // Command region offsets
    private const int OffWriteIdx = 2640;
    private const int OffReadIdx = 2644;
    private const int OffCmds = 2648;
    private const int CmdSize = 48;

    // Command opcodes
    private const byte CmdSetSteamId = 1;
    private const byte CmdSetPersona = 2;
    private const byte CmdSetDisguise = 3;
    private const byte CmdRebuild = 4;
    // 5 (KickAll) and 6 (Refill) retired — match-end clean-rebuild removed
    private const byte CmdSetNameSource = 7;

    // Sentinel slot for global commands
    private const byte SlotAll = 255;

    private MemoryMappedFile? _mmf;
    private MemoryMappedViewAccessor? _view;
    private readonly object _writeLock = new();

    private readonly Action<int, string>? _onVisibleName;

    private readonly Action<int, ulong>? _onVisibleSid;

    public SharedMemoryClient(Action<int, string>? onVisibleName = null,
                              Action<int, ulong>? onVisibleSid = null)
    {
        _onVisibleName = onVisibleName;
        _onVisibleSid = onVisibleSid;
    }

    // Try to open the existing mapping. Returns false if BotHider isn't loaded yet
    public bool TryConnect()
    {
        if (_view != null) return true;
        try
        {
            _mmf = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
                ? MemoryMappedFile.OpenExisting(MappingName, MemoryMappedFileRights.ReadWrite)
                : MemoryMappedFile.CreateFromFile(PosixMappingPath, FileMode.Open, null,
                    TotalSize, MemoryMappedFileAccess.ReadWrite);
            _view = _mmf.CreateViewAccessor(0, TotalSize,
                MemoryMappedFileAccess.ReadWrite);
            if (_view.ReadUInt32(OffMagic) != Magic) { Dispose(); return false; }
            return true;
        }
        catch (FileNotFoundException) { return false; }
        catch (Exception) { Dispose(); return false; }
    }

    private bool Valid(int slot)
    {
        if (_view == null) TryConnect();
        return _view != null && slot >= 0 && slot < MaxSlots;
    }

    // IBotHiderApi: read side

    public bool IsManagedBot(int slot) =>
        Valid(slot) && _view!.ReadByte(OffSlotState + slot) != 0;

    public ulong GetSyntheticSteamId(int slot) =>
        Valid(slot) ? _view!.ReadUInt64(OffSyntheticSid + slot * 8) : 0UL;

    public int[] GetManagedSlots()
    {
        if (_view == null) TryConnect();
        if (_view == null) return Array.Empty<int>();
        var list = new List<int>();
        for (int s = 0; s < MaxSlots; s++)
            if (_view.ReadByte(OffSlotState + s) != 0) list.Add(s);
        return list.ToArray();
    }

    public string GetPersonaName(int slot)
    {
        if (!Valid(slot)) return string.Empty;
        var buf = new byte[NameLen];
        _view!.ReadArray(OffPersonaName + slot * NameLen, buf, 0, NameLen);
        int len = Array.IndexOf(buf, (byte)0);
        if (len < 0) len = NameLen;
        return Encoding.UTF8.GetString(buf, 0, len);
    }

    public int GetPing(int slot) =>
        Valid(slot) ? _view!.ReadInt32(OffCurrentPing + slot * 4) : 0;

    public string GetCrosshairCode(int slot)
    {
        if (!Valid(slot)) return string.Empty;
        var buf = new byte[CrosshairLen];
        _view!.ReadArray(OffCrosshair + slot * CrosshairLen, buf, 0, CrosshairLen);
        int len = Array.IndexOf(buf, (byte)0);
        if (len < 0) len = CrosshairLen;
        return Encoding.UTF8.GetString(buf, 0, len);
    }

    // IBotHiderApi: write side

    public bool SetBotSteamId(int slot, ulong steamId64)
    {
        if (!Valid(slot)) return false;
        bool ok = PostCommand(CmdSetSteamId, slot, steamId64, null);
        if (ok) _onVisibleSid?.Invoke(slot, steamId64);
        return ok;
    }

    public bool SetPersonaName(int slot, string name)
    {
        if (!Valid(slot) || string.IsNullOrEmpty(name)) return false;
        bool ok = PostCommand(CmdSetPersona, slot, 0UL, name);
        if (ok) _onVisibleName?.Invoke(slot, name);
        return ok;
    }

    // Global disguise toggle
    public bool SetDisguise(bool enabled)
    {
        if (_view == null) TryConnect();
        if (_view == null) return false;
        return PostCommand(CmdSetDisguise, SlotAll, enabled ? 1UL : 0UL, null);
    }

    // Global display-name source toggle (1=bot_info name, 0=botprofile name)
    public bool SetNameSource(bool useBotInfo)
    {
        if (_view == null) TryConnect();
        if (_view == null) return false;
        return PostCommand(CmdSetNameSource, SlotAll, useBotInfo ? 1UL : 0UL, null);
    }

    // Request a clean bot rebuild
    public bool RequestRebuild()
    {
        if (_view == null) TryConnect();
        if (_view == null) return false;
        return PostCommand(CmdRebuild, SlotAll, 0UL, null);
    }

    private bool PostCommand(byte type, int slot, ulong sid, string? name)
    {
        if (_view == null) return false;
        lock (_writeLock)
        {
            uint w = _view.ReadUInt32(OffWriteIdx);
            int baseOff = OffCmds + (int)(w % CmdCount) * CmdSize;

            _view.Write(baseOff + 0, type);
            _view.Write(baseOff + 1, (byte)slot);
            _view.Write(baseOff + 8, sid);
            var nameBuf = new byte[NameLen];
            if (name != null)
            {
                int n = Encoding.UTF8.GetBytes(name, 0,
                    Math.Min(name.Length, NameLen - 1), nameBuf, 0);
            }
            _view.WriteArray(baseOff + 16, nameBuf, 0, NameLen);

            Interlocked.MemoryBarrier();
            _view.Write(OffWriteIdx, w + 1);
        }
        return true;
    }

    public void Dispose()
    {
        _view?.Dispose();
        _mmf?.Dispose();
        _view = null;
        _mmf = null;
    }
}
