import fetch from "node-fetch";
import moment from "moment";
import dotenv from "dotenv"

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
const READ_ONLY = !true
const SPLITWISE_EXPENSE_FETCH_LIMIT = parseInt(process.env.SPLITWISE_EXPENSE_FETCH_LIMIT || '100', 10)
const DEBUG_MODE = process.env.DEBUG_MODE === 'true'

const callApi = async (endpoint, body) => {
    let resp = await fetch(`https://secure.splitwise.com/api/v3.0/${endpoint}?` + new URLSearchParams(body), {
        headers: { Authorization: `Bearer ${APIKEY}` },
    });
    // console.log(resp);
    resp = await resp.json();
    return resp
}

const getGroups = async () => {
    const { groups } = await callApi("get_groups")
    return groups
}

const populateGroupMappings = async () => {
    const groups = await getGroups();
    for (const group of groups) {
        groupIdToName[group.id] = group.name;
        groupNameToId[group.name] = group.id;
    }
    console.log("Group ID to Name Mapping:", groupIdToName);
    console.log("Group Name to ID Mapping:", groupNameToId);
}

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
    let resp = await fetch(`${CATEGORY_PREDICTION_SERVER_URL}/get_expense?expenseName=${expense.description}`)
    resp = await resp.json()
    const processedExpense = {
        name: expense.description,
        amount: 0,
        date: moment(expense.date).format("YYYY-MM-DD"),
        splitwiseExpenseId: expense.id,
        typeId: resp.categoryId,
        tags: tags
    }
    console.log({ expense: expense.description, categoryId: resp.categoryId })
    // console.log(expense.category);

    for (let user of expense.users) {
        if (user.user_id === USERID) {
            processedExpense.amount = parseFloat(user.owed_share)
        }
    }

    // console.log(processedExpense);
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
            const existResp = await fetch(`${EXPENSE_SERVER}/checkExpenseExistsBySplitwiseId?splitwiseExpenseId=${expense.splitwiseExpenseId}`)
            const { exists } = await existResp.json()
            if (exists) {
                console.log("Expense exists");
                continue
            }
        } catch (e) {
            console.log("Check expense error.", e);
        }

        console.log("Inserting expense:", expense);
        if (READ_ONLY) {
            console.log("Running in read-nly mode, not inserting expense to DB");
            continue;
        }
        try {
            const rawResponse = await fetch(`${EXPENSE_SERVER}/expenseEntry`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(
                    expense
                )
            });
            // console.debug(rawResponse);
            const content = await rawResponse.json();
            // console.debug(content);
            console.log(`Expense inserted: ${content.createRes2.id}`);
        } catch (e) {
            console.log("Insert expense error.", e);
        }
    }
}





const getAllExpenses = async () => {
    const resp = await callApi("get_expenses", { limit: SPLITWISE_EXPENSE_FETCH_LIMIT })
    // console.debug(resp)
    return resp
}

const run = async () => {
    console.log(`Expense Server: ${EXPENSE_SERVER}`);

    await populateGroupMappings();

    const { expenses } = await getAllExpenses();
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
    let resp = await fetch(UPTIME_KUMA_URL)
    resp = await resp.json();
    console.log(resp);


};


run();
