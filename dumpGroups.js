import fs from "fs";
import { getGroups } from "./import.js";

const run = async () => {
    const groups = await getGroups();
    fs.writeFileSync("groups.json", JSON.stringify(groups, null, 4));
    console.log("Successfully wrote groups to groups.json");
};

run().catch((err) => {
    console.error("dumpGroups failed:", err);
    process.exit(1);
});