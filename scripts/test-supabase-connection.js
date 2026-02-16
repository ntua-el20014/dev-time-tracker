#!/usr/bin/env node

/**
 * Quick Supabase Authentication Test Script
 * Run this to test your Supabase integration outside of Electron
 */

const https = require("https");
const { URL } = require("url");

// Your Supabase configuration
const SUPABASE_URL = "https://wzztlcwwuwadketoafna.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6enRsY3d3dXdhZGtldG9hZm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxNDI2OTUsImV4cCI6MjA3NDcxODY5NX0.DBV1yV9YP2bLqRGo2TUMrhc3mhLs948FKxMdQUQLJ1w";

function testSupabaseConnectivity() {
  return new Promise((resolve, reject) => {
    const testUrl = new URL("/rest/v1/", SUPABASE_URL);

    const options = {
      hostname: testUrl.hostname,
      port: 443,
      path: testUrl.pathname,
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "User-Agent": "DevTimeTracker-Test/1.0",
      },
    };

    console.log("🔍 Testing Supabase connectivity...");
    console.log(`📡 Target: ${SUPABASE_URL}/rest/v1/`);

    const startTime = Date.now();

    const req = https.request(options, (res) => {
      const latency = Date.now() - startTime;

      console.log(`📊 Response: ${res.statusCode} ${res.statusMessage}`);
      console.log(`⏱️ Latency: ${latency}ms`);
      console.log(`📋 Headers:`, res.headers);

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log("✅ Supabase is reachable and responding correctly!");
          console.log("📄 Response sample:", data.substring(0, 200) + "...");
          resolve({ success: true, latency, statusCode: res.statusCode });
        } else {
          console.log("❌ Supabase returned an error status");
          console.log("📄 Response:", data);
          resolve({
            success: false,
            latency,
            statusCode: res.statusCode,
            error: data,
          });
        }
      });
    });

    req.on("error", (error) => {
      const latency = Date.now() - startTime;
      console.error("❌ Connection failed:", error.message);

      if (error.code === "ENOTFOUND") {
        console.error("🌐 DNS lookup failed - check your internet connection");
      } else if (error.code === "ECONNREFUSED") {
        console.error("🚫 Connection refused - server may be down");
      } else if (error.code === "ETIMEDOUT") {
        console.error("⏰ Connection timed out");
      }

      reject({
        success: false,
        latency,
        error: error.message,
        code: error.code,
      });
    });

    req.setTimeout(10000, () => {
      console.error("⏰ Request timed out after 10 seconds");
      req.destroy();
      reject({ success: false, error: "Timeout" });
    });

    req.end();
  });
}

async function runTests() {
  console.log("🚀 Starting Supabase connectivity tests...\n");

  try {
    const result = await testSupabaseConnectivity();

    if (result.success) {
      console.log(
        "\n🎉 All tests passed! Your Supabase configuration appears to be working."
      );
      console.log("\n📝 Next steps:");
      console.log("   1. Start your Electron app: npm start");
      console.log('   2. Click "Test Supabase Connection" in the app');
      console.log("   3. Try signing up with a test email");
    } else {
      console.log("\n❌ Tests failed. Check the error details above.");
      console.log("\n🔧 Troubleshooting:");
      console.log("   1. Check your internet connection");
      console.log("   2. Verify your Supabase project is active");
      console.log("   3. Confirm your API keys are correct");
    }
  } catch (error) {
    console.error("\n💥 Test script failed:", error);
  }
}

// Run the tests
if (require.main === module) {
  runTests();
}

module.exports = { testSupabaseConnectivity };
