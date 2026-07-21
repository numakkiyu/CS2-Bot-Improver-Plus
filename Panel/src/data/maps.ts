import mirageImage from "../assets/maps/mirage.webp";
import infernoImage from "../assets/maps/inferno.webp";
import dust2Image from "../assets/maps/dust2.webp";
import nukeImage from "../assets/maps/nuke.webp";
import ancientImage from "../assets/maps/ancient.webp";
import anubisImage from "../assets/maps/anubis.webp";
import trainImage from "../assets/maps/train.webp";
import overpassImage from "../assets/maps/overpass.webp";
import vertigoImage from "../assets/maps/vertigo.webp";
import cacheImage from "../assets/maps/cache.webp";

export const MAP_LABELS: Record<string, string> = {
  de_mirage: "MIRAGE", de_inferno: "INFERNO", de_dust2: "DUST II", de_nuke: "NUKE", de_ancient: "ANCIENT",
  de_anubis: "ANUBIS", de_train: "TRAIN", de_overpass: "OVERPASS", de_vertigo: "VERTIGO", de_cache: "CACHE",
};

export const MAP_IMAGES: Record<string, string> = {
  de_mirage: mirageImage, de_inferno: infernoImage, de_dust2: dust2Image, de_nuke: nukeImage, de_ancient: ancientImage,
  de_anubis: anubisImage, de_train: trainImage, de_overpass: overpassImage, de_vertigo: vertigoImage, de_cache: cacheImage,
};
