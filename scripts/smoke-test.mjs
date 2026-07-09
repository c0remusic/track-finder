const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const QUERY = "Robert Hood Minus";

const response = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(QUERY)}`);
if (!response.ok) {
  console.error(`FAIL: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const data = await response.json();
console.log(`Query: "${QUERY}"`);
for (const result of data.purchase) {
  console.log(`  ${result.platform}: ${result.status}${result.purchaseUrl ? ` -> ${result.purchaseUrl}` : ""}`);
}
console.log("Metadata:", JSON.stringify(data.metadata, null, 2));
