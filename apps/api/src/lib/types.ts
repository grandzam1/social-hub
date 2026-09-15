export type Platform = "instagram" | "tiktok" | "x";

export type NormalizedMedia = {
  mediaId: string;
  order: number;
  type: "image" | "video" | "gif";
  fileUrl: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  fileType?: string;
};

export type NormalizedScrape = {
  platform: Platform;
  postId: string;
  url: string;
  caption: string;
  authorHandle: string;
  authorName?: string;
  authorAvatar?: string;
  authorVerified?: boolean;
  authorFollowers?: number;
  platformUserId?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  saves?: number;
  postedAt?: string;
  durationSec?: number;
  postType?: string;
  /** quote | retweet when media/text came from nested status */
  repostKind?: "quote" | "retweet";
  quotedHandle?: string;
  quotedText?: string;
  cover?: string;
  media: NormalizedMedia[];
  creditsCharged?: number;
  creditsRemaining?: number;
  cached?: boolean;
};
