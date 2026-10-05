export function posterSourceUrl(input: {
  apifyCover?: string;
  cdnCover?: string;
}): string {
  const apify = input.apifyCover?.trim() || "";
  if (apify.includes("api.apify.com")) return apify;
  return input.cdnCover?.trim() || "";
}
