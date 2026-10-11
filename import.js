import fetch from "node-fetch";
import moment from "moment";
import dotenv from "dotenv"
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ override: true })

const APIKEY = process.env.SPLITWISE_API_KEY; // Bearer auth
const USERID = 23804942
let groupIdToName = {};
let groupNameToId = {};

const HOST = process.env.HOST
const PORT = process.env.PORT
const EXPENSE_SERVER = `http://${HOST}:${PORT}`
const CATEGORY_PREDICTION_SERVER_URL = process.env.CATEGORY_PREDICTION_SERVER_URL
const UPTIME_KUMA_URL = process.env.UPTIME_KUMA_URL
export const isReadOnly = () => process.env.READ_ONLY === 'true' || 
    process.env.DRY_RUN === 'true' || 
    process.argv.includes('--dry-run') || 
    process.argv.includes('--read-only');
const SPLITWISE_EXPENSE_FETCH_LIMIT = parseInt(process.env.SPLITWISE_EXPENSE_FETCH_LIMIT || '100', 10);
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

const fetchClient = (...args) => (globalThis.fetch ? globalThis.fetch(...args) : fetch(...args));

export const getSessionCookie = () => {
    const cookiePath = process.env.SPLITWISE_COOKIE_PATH || './data/cookies.txt';
    if (fs.existsSync(cookiePath)) {
        try {
            const fileContent = fs.readFileSync(cookiePath, 'utf8').trim();
            if (fileContent) return fileContent;
        } catch (e) {
            console.warn(`Failed to read cookie from ${cookiePath}:`, e.message);
        }
    }
    return process.env.SPLITWISE_SESSION_COOKIE;
};

export const saveSessionCookie = (newCookieStr) => {
    process.env.SPLITWISE_SESSION_COOKIE = newCookieStr;
    if (process.env.NODE_ENV !== "test") {
        try {
            const cookiePath = process.env.SPLITWISE_COOKIE_PATH || './data/cookies.txt';
            fs.mkdirSync(path.dirname(cookiePath), { recursive: true });
            fs.writeFileSync(cookiePath, newCookieStr, "utf8");
            console.log(`ℹ️  Persisted renewed Splitwise session cookie to ${cookiePath}`);
        } catch (err) {
            console.warn("Failed to persist renewed session cookie:", err.message);
        }
    }
};

export const updateSessionCookieFromHeaders = (headers) => {
    if (!headers) return;
    const setCookies = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : (typeof headers.raw === "function" && headers.raw()["set-cookie"]) || [];

    if (!setCookies || setCookies.length === 0) return;

    const currentCookie = getSessionCookie() || "";
    const cookieMap = new Map();
    for (const part of currentCookie.split(";")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            cookieMap.set(trimmed.slice(0, eqIdx).trim(), trimmed.slice(eqIdx + 1).trim());
        }
    }

    let changed = false;
    for (const sc of setCookies) {
        const firstPart = sc.split(";")[0]?.trim();
        if (!firstPart) continue;
        const eqIdx = firstPart.indexOf("=");
        if (eqIdx > 0) {
            const name = firstPart.slice(0, eqIdx).trim();
            const val = firstPart.slice(eqIdx + 1).trim();
            if (name && val && cookieMap.get(name) !== val) {
                cookieMap.set(name, val);
                changed = true;
            }
        }
    }

    if (changed) {
        const newCookieStr = Array.from(cookieMap.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join("; ");
        saveSessionCookie(newCookieStr);
    }
};

export const callApi = async (endpoint, body = {}) => {
    const sessionCookie = getSessionCookie();
    const apiKey = process.env.SPLITWISE_API_KEY;

    if (!sessionCookie && !apiKey) {
        throw new Error("SPLITWISE_API_KEY is not set or empty in environment variables (nor SPLITWISE_SESSION_COOKIE)");
    }

    const queryParams = body && Object.keys(body).length > 0 ? `?${new URLSearchParams(body).toString()}` : "";
    const url = `https://secure.splitwise.com/api/v3.0/${endpoint}${queryParams}`;

    const headers = {};
    if (sessionCookie) {
        // Cookie-based auth using web session (bypasses API key paywall)
        headers['Cookie'] = sessionCookie;
        headers['Accept'] = 'application/json';
        // Mimic browser request to avoid being blocked
        headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        headers['Referer'] = 'https://secure.splitwise.com/';
        headers['X-Requested-With'] = 'XMLHttpRequest';
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const resp = await fetchClient(url, { headers });

    if (sessionCookie && resp.headers) {
        updateSessionCookieFromHeaders(resp.headers);
    }

    const text = await resp.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        const preview = text ? text.replace(/\s+/g, " ").trim().slice(0, 200) : "empty response";
        throw new Error(`Splitwise API (${endpoint}) returned non-JSON response (${resp.status} ${resp.statusText}): ${preview}`);
    }

    if (!resp.ok) {
        let errorDetails;
        if (data && typeof data === "object") {
            if (data.error) {
                errorDetails = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
            } else if (data.errors) {
                errorDetails = typeof data.errors === "string" ? data.errors : JSON.stringify(data.errors);
            } else {
                errorDetails = JSON.stringify(data);
            }
        } else {
            errorDetails = text || resp.statusText;
        }
        throw new Error(`Splitwise API error (${resp.status} ${resp.statusText}) on endpoint '${endpoint}': ${errorDetails}`);
    }

    return data;
};

export const getGroups = async () => {
    const data = await callApi("get_groups");
    if (!data || !Array.isArray(data.groups)) {
        throw new Error(`Expected 'groups' array from Splitwise API, received: ${JSON.stringify(data)}`);
    }
    return data.groups;
};

export const populateGroupMappings = async () => {
    const groups = await getGroups();
    for (const key of Object.keys(groupIdToName)) delete groupIdToName[key];
    for (const key of Object.keys(groupNameToId)) delete groupNameToId[key];
    for (const group of groups) {
        groupIdToName[group.id] = group.name;
        groupNameToId[group.name] = group.id;
    }
    console.log("Group ID to Name Mapping:", groupIdToName);
    console.log("Group Name to ID Mapping:", groupNameToId);
};

const getUser = async () => {
    return await callApi("get_current_user")
}

const getExpense = async () => {
    return await callApi("get_expense")
}

const getExpenseForGroup = async (groupId) => {
    const resp = await callApi("get_expenses", { group_id: groupId, limit: 100 })
    // console.debug(resp)
    return resp
}

// Processes a single expense from the Splitwise API
const procesSingleExpenseForBudgetApp = async (expense, tags) => {
    // Get category prediction
    let categoryId = null;
    if (CATEGORY_PREDICTION_SERVER_URL) {
        try {
            let resp = await fetchClient(`${CATEGORY_PREDICTION_SERVER_URL}/get_expense?expenseName=${encodeURIComponent(expense.description)}`);
            let data = await resp.json();
            categoryId = data.categoryId;
        } catch (e) {
            console.warn(`Category prediction failed for '${expense.description}':`, e.message);
        }
    }
    const processedExpense = {
        name: expense.description,
        amount: 0,
        date: moment(expense.date).format("YYYY-MM-DD"),
        splitwiseExpenseId: expense.id,
        typeId: categoryId,
        tags: tags
    }
    console.log({ expense: expense.description, categoryId })

    for (let user of expense.users) {
        if (user.user_id === USERID) {
            processedExpense.amount = parseFloat(user.owed_share)
        }
    }

    return processedExpense
}

// Processes and returns a list of expenses from Splitwise API
const processExpensesForBudgetApp = async (expenses, tags) => {
    const processedExpense = []
    for (let expense of expenses) {
        const pexp = await procesSingleExpenseForBudgetApp(expense, tags)
        if (pexp.amount === 0) continue
        // This is not really a expense but more of a additional entry in splitwise
        // that is created when payments are made across multiple groups. Therefore
        // this should not be added to expenses.
        if (pexp.name === "Settle all balances") {
            console.log("Skipping 'Settle all balances' entry");
            continue;
        }
        processedExpense.push(pexp)
    }

    return processedExpense
}

/*
 * For a given list of expenses, check if it exists in the DB already, otherwise
 * insert it.
 */

const sendExpenseEntries = async (expenses) => {
    for (let expense of expenses) {
        console.log("Checking expense's splitwise id:", expense.splitwiseExpenseId);
        try {
            const existResp = await fetchClient(`${EXPENSE_SERVER}/checkExpenseExistsBySplitwiseId?splitwiseExpenseId=${expense.splitwiseExpenseId}`);
            const { exists } = await existResp.json();
            if (exists) {
                console.log("Expense exists");
                continue;
            }
        } catch (e) {
            console.log("Check expense error:", e.message);
        }

        if (isReadOnly()) {
            console.log(`[DRY-RUN] Skipping DB insert for expense '${expense.name}' (ID: ${expense.splitwiseExpenseId}, Amount: ${expense.amount})`);
            continue;
        }

        console.log("Inserting expense:", expense);
        try {
            const rawResponse = await fetchClient(`${EXPENSE_SERVER}/expenseEntry`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(expense)
            });
            const content = await rawResponse.json();
            console.log(`Expense inserted: ${content.createRes2.id}`);
        } catch (e) {
            console.log("Insert expense error:", e.message);
        }
    }
}





export const getAllExpenses = async () => {
    const data = await callApi("get_expenses", { limit: SPLITWISE_EXPENSE_FETCH_LIMIT });
    if (!data || !Array.isArray(data.expenses)) {
        throw new Error(`Expected 'expenses' array from Splitwise API, received: ${JSON.stringify(data)}`);
    }
    return data.expenses;
};

export const run = async () => {
    console.log(`Expense Server: ${EXPENSE_SERVER}`);

    await populateGroupMappings();

    const expenses = await getAllExpenses();
    console.log("Total expenses to process:", expenses.length);

    for (const expense of expenses) {
        if (DEBUG_MODE) {
            console.log("Received expense from API:", JSON.stringify(expense, null, 2));
        }
        let tags = [];
        if (expense.group_id) {
            const groupName = groupIdToName[expense.group_id];
            if (groupName) {
                tags.push("splitwise-" + groupName.trim().replace(/ /g, "-"));
            } else {
                console.warn(`Group name not found for group_id: ${expense.group_id}`);
                tags.push("splitwise-unknown-group");
            }
        } else {
            tags.push("splitwise-non-group");
        }

        const processedExpense = await procesSingleExpenseForBudgetApp(expense, tags);
        if (expense.payment) {
            console.log(`Skipping expense '${expense.description}' (ID: ${expense.id}) as it is a payment entry.`);
        } else if (processedExpense.amount === 0) {
            console.log(`Skipping expense '${processedExpense.name}' (ID: ${processedExpense.splitwiseExpenseId}) due to zero amount.`);
        } else if (processedExpense.name === "Settle all balances") {
            console.log(`Skipping expense '${processedExpense.name}' (ID: ${processedExpense.splitwiseExpenseId}) as it is a settlement entry.`);
        } else {
            await sendExpenseEntries([processedExpense]);
        }
    }

    // If everything went well, ping uptime kuma to report job ran successfully.
    if (isReadOnly()) {
        console.log("[DRY-RUN] Skipping Uptime Kuma heartbeat ping in dry-run mode.");
        return;
    }

    if (UPTIME_KUMA_URL) {
        try {
            let resp = await fetchClient(UPTIME_KUMA_URL);
            const text = await resp.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch {
                result = text;
            }
            console.log("Uptime Kuma ping response:", result);
        } catch (err) {
            console.warn("Failed to ping Uptime Kuma:", err.message);
        }
    }
};

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 */2 * * *";
const RUN_ONCE = process.argv.includes('--run-once') || process.argv.includes('--dry-run') || process.env.RUN_ONCE === 'true';

const isMain = process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

let task;
if (process.env.NODE_ENV !== "test" && isMain) {
    if (isReadOnly()) {
        console.log("ℹ️  Running in READ-ONLY / DRY-RUN mode. No expenses will be inserted to DB, and Uptime Kuma will not be pinged.");
    }

    if (RUN_ONCE) {
        console.log("Running once...");
        run().then(() => {
            console.log("Run complete.");
            process.exit(0);
        }).catch((err) => {
            console.error("Run failed:", err);
            process.exit(1);
        });
    } else {
        console.log(`Starting with cron schedule: ${CRON_SCHEDULE}`);
        console.log("Running immediately on startup...");
        run().then(() => {
            console.log("Initial run complete. Scheduling future runs...");
        }).catch((err) => {
            console.error("Initial run failed:", err);
        });

        task = cron.schedule(CRON_SCHEDULE, () => {
            console.log(`\n--- Cron triggered at ${new Date().toISOString()} ---`);
            run().catch((err) => {
                console.error("Scheduled run failed:", err);
            });
        });

        // Graceful shutdown
        const shutdown = () => {
            console.log("\nShutting down...");
            if (task) task.stop();
            process.exit(0);
        };

        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
    }
}

export {
    groupIdToName,
    groupNameToId,
};
