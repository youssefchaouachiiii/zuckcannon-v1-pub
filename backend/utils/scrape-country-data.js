const fs = require('fs');
const https = require('https');

// Replace with your actual access token
const ACCESS_TOKEN = 'EAARVcSEqf2EBPItmtP7nXOw8ikhBTNTJgzPj30oF0AhNHVcQneYYNDpkheCotRnWDPmZCjvCZB0EZAI3KuwdSf3LJcBZCHq1HFVFCFkgT0NRP2W3a62Ah6B40f5nQc3kCZBZCA9d6WSNrtPL3BXC6gJGwHIsX4aYK7tRlZAN3OvHZBYKGb6MOxfOD7rV4ZBkZAATrh8Syg70G6VeVvZBOE38Mb2SqqbEztY6fH6pqBy9qcuzXxfPMC1lHbnygZDZD';
const BASE_URL = 'https://graph.facebook.com/v23.0';

// Helper function to make API requests
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

// Sleep function for rate limiting
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeLocationData() {
    console.log('🚀 Starting Facebook location data scrape...');

    try {
        // Step 1: Get all countries
        console.log('📍 Fetching all countries...');
        const countriesUrl = `${BASE_URL}/search?type=adgeolocation&location_types=["country"]&limit=1000&access_token=${ACCESS_TOKEN}`;
        const countriesResponse = await makeRequest(countriesUrl);
        const countries = countriesResponse.data;

        console.log(`✅ Found ${countries.length} countries`);

        // Step 2: Get regions for countries that support them
        const locationData = {
            countries: countries,
            regions: {},
            generated_at: new Date().toISOString(),
            total_countries: countries.length
        };

        // Filter countries that support regions
        const countriesWithRegions = countries.filter(country => country.supports_region);
        console.log(`🌍 ${countriesWithRegions.length} countries support regions`);

        let processedCount = 0;

        for (const country of countriesWithRegions) {
            try {
                console.log(`🔍 Fetching regions for ${country.name} (${country.country_code})...`);

                const regionsUrl = `${BASE_URL}/search?type=adgeolocation&location_types=["region"]&country_code=${country.country_code}&limit=1000&access_token=${ACCESS_TOKEN}`;
                const regionsResponse = await makeRequest(regionsUrl);

                locationData.regions[country.country_code] = {
                    country_name: country.name,
                    country_key: country.key,
                    regions: regionsResponse.data || [],
                    total_regions: regionsResponse.data ? regionsResponse.data.length : 0
                };

                processedCount++;
                console.log(`✅ ${country.name}: ${regionsResponse.data ? regionsResponse.data.length : 0} regions`);

                // Rate limiting - be nice to Facebook's API
                if (processedCount % 5 === 0) {
                    console.log('⏳ Pausing for rate limiting...');
                    await sleep(2000); // 2 second pause every 5 requests
                } else {
                    await sleep(500); // 0.5 second between requests
                }

            } catch (error) {
                console.error(`❌ Error fetching regions for ${country.name}:`, error.message);
                // Continue with other countries even if one fails
                locationData.regions[country.country_code] = {
                    country_name: country.name,
                    country_key: country.key,
                    regions: [],
                    total_regions: 0,
                    error: error.message
                };
            }
        }

        // Step 3: Save to JSON file
        console.log('💾 Saving data to file...');
        const fileName = `facebook-locations-${new Date().toISOString().split('T')[0]}.json`;

        fs.writeFileSync(fileName, JSON.stringify(locationData, null, 2));

        // Generate summary
        const totalRegions = Object.values(locationData.regions)
            .reduce((sum, country) => sum + country.total_regions, 0);

        console.log('\n🎉 Scraping completed!');
        console.log(`📊 Summary:`);
        console.log(`   - Total countries: ${countries.length}`);
        console.log(`   - Countries with regions: ${Object.keys(locationData.regions).length}`);
        console.log(`   - Total regions: ${totalRegions}`);
        console.log(`   - File saved: ${fileName}`);
        console.log(`   - File size: ${(fs.statSync(fileName).size / 1024 / 1024).toFixed(2)} MB`);

    } catch (error) {
        console.error('💥 Fatal error:', error);
    }
}

// Run the scraper
scrapeLocationData();