Turns a post URL or a profile handle into NormalizedScrape through one provider.
Exposes getScraper(env) and the ScrapeProvider type. Providers are scrapecreators and apify.
Needs the setting scrape_order (default apify,scrapecreators) and scrape_auto_switch (default on). The first name is the primary. Provider-level failures try the next name. scrape_provider is still read when scrape_order is unset. ScrapeCreators uses connection scrapecreators or SCRAPECREATORS_API_KEY. Apify uses connection apify or APIFY_TOKEN, plus apify_actor_instagram, apify_actor_tiktok, and apify_actor_x.
