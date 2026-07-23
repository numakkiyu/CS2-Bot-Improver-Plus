export type ProjectLink = {
  id: "plus" | "upstream";
  name: string;
  url: string;
};

export type Contributor = {
  login: string;
  avatar: string;
  profileUrl: string;
  role: "plusMaintainer" | "upstreamAuthor" | "contributor";
  contributions?: number;
};

export const PROJECTS: ProjectLink[] = [
  {
    id: "plus",
    name: "numakkiyu/Local-Arena",
    url: "https://github.com/numakkiyu/Local-Arena",
  },
  {
    id: "upstream",
    name: "ed0ard/CS2-Bot-Improver",
    url: "https://github.com/ed0ard/CS2-Bot-Improver",
  },
];

// Snapshot of the Local Arena repository owner and GitHub contributor API on 2026-07-14.
export const CONTRIBUTORS: Contributor[] = [
  {
    login: "numakkiyu",
    avatar: "/contributors/numakkiyu.png",
    profileUrl: "https://github.com/numakkiyu",
    role: "plusMaintainer",
  },
  {
    login: "ed0ard",
    avatar: "/contributors/ed0ard.png",
    profileUrl: "https://github.com/ed0ard",
    role: "upstreamAuthor",
    contributions: 325,
  },
  {
    login: "XBribo",
    avatar: "/contributors/xbribo.png",
    profileUrl: "https://github.com/XBribo",
    role: "contributor",
    contributions: 5,
  },
  {
    login: "Misaka17032",
    avatar: "/contributors/misaka17032.png",
    profileUrl: "https://github.com/Misaka17032",
    role: "contributor",
    contributions: 4,
  },
  {
    login: "Floretteee",
    avatar: "/contributors/floretteee.png",
    profileUrl: "https://github.com/Floretteee",
    role: "contributor",
    contributions: 2,
  },
  {
    login: "RaycarlLei",
    avatar: "/contributors/raycarllei.png",
    profileUrl: "https://github.com/RaycarlLei",
    role: "contributor",
    contributions: 1,
  },
];
