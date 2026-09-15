export type Platform = "instagram" | "tiktok" | "x";

export type NormalizedPost = {
  platform: Platform;
  platformPostId: string;
  caption: string;
  url: string;
};

export type ScrapePostRequest = {
  url: string;
  saveToR2?: boolean;
  saveMode?: "sync" | "async";
  force?: boolean;
};
