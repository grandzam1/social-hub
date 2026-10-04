Turns a post URL or a profile handle into NormalizedScrape through one provider.
Exposes getScraper(env) and the ScrapeProvider type. Providers are scrapecreators (default) and apify.
Needs the setting scrape_provider. ScrapeCreators uses connection scrapecreators or SCRAPECREATORS_API_KEY. Apify uses connection apify or APIFY_TOKEN, plus apify_actor_instagram, apify_actor_tiktok, and apify_actor_x.
