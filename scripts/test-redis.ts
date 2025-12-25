import { redis } from "../lib/redis";

async function main() {
    console.log("Testing Redis connection...");

    const testKey = "test:summary-cache-check:" + Date.now();
    const testValue = "test-value-" + Date.now();

    try {
        console.log(`Setting key: ${testKey}`);
        await redis.set(testKey, testValue);
        console.log("Set command successful.");

        console.log(`Getting key: ${testKey}`);
        const retrieved = await redis.get(testKey);
        console.log(`Retrieved value: ${retrieved}`);

        if (retrieved === testValue) {
            console.log("SUCCESS: Redis read/write works.");
        } else {
            console.error("FAILURE: Retrieved value does not match set value.");
        }

        console.log("Cleaning up...");
        await redis.del(testKey);
        console.log("Cleanup complete.");

    } catch (error) {
        console.error("Redis Error:", error);
    }
}

main();
