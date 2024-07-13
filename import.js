import fetch from "node-fetch";
import moment from "moment";
import dotenv from "dotenv"

dotenv.config()

const APIKEY = process.env.SPLITWISE_API_KEY; // Bearer auth
const USERID = 23804942
const GROUPIDS = {
    AG01V3Group: "56584765",
    Printing3DGroup: "62299357",
    PragiBachelorette: "66554786"
}

const HOST = process.env.HOST
const PORT = process.env.PORT
const EXPENSE_SERVER = `http://${HOST}:${PORT}`

const callApi = async (endpoint, body) => {
    let resp = await fetch(`https://secure.splitwise.com/api/v3.0/${endpoint}?` + new URLSearchParams(body), {
        headers: { Authorization: `Bearer ${APIKEY}` },
    });
    // console.log(resp);
    resp = await resp.json();
    return resp
}

const getGroups = async () => {
    return await callApi("get_groups")
}

const getUser = async () => {
    return await callApi("get_current_user")
}

const getExpense = async () => {
    return await callApi("get_expense")
}

const getExpenseForGroup = async (groupId) => {
    const resp = await callApi("get_expenses", { group_id: groupId, limit: 100 })
    return resp
}

// Processes a single expense from the Splitwise API
const procesSingleExpenseForBudgetApp = async (expense) => {
    // Get category prediction
    let resp = await fetch(`http://${HOST}:3001/get_expense?expenseName=${expense.description}`)
    resp = await resp.json()
    const processedExpense = {
        name: expense.description,
        amount: 0,
        date: moment(expense.date).format("YYYY-MM-DD"),
        splitwiseExpenseId: expense.id,
        typeId: resp.categoryId
    }
    console.log({ expense: expense.description, categoryId: resp.categoryId })
    // console.log(expense.category);

    for (let user of expense.users) {
        if (user.user_id === USERID) {
            processedExpense.amount = user.owed_share
        }
    }

    // console.log(processedExpense);
    return processedExpense
}

// Processes and returns a list of expenses from Splitwise API
const processExpensesForBudgetApp = async (expenses) => {
    const processedExpense = []
    for (let expense of expenses) {
        const pexp = await procesSingleExpenseForBudgetApp(expense)
        if (pexp.amount === 0) continue
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

/**
 * Queries splitwise for expenses on a particular group
 * and adds expenses for that group to expense mgmt system
 * @param {*} groupId splitwise id of the group
 * @param {*} groupName optional group name for logs
 */
const processGroupExpenses = async (groupId, groupName) => {
    console.log(`Processing expenses for ${groupName} Group`);
    const { expenses } = await getExpenseForGroup(groupId)
    console.log("Expenses to process:", expenses.length);
    const processedExpense = await processExpensesForBudgetApp(expenses)
    console.log(processedExpense);
    await sendExpenseEntries(processedExpense)
}

const process3dPrintingExpenses = async () => {
    console.log("Processing expenses for 3D Printing Group");
    const { expenses } = await getExpenseForGroup(GROUPIDS.Printing3DGroup)
    console.log("Expenses to process:", expenses.length);
    const processedExpense = await processExpensesForBudgetApp(expenses)
    console.log(processedExpense);
    await sendExpenseEntries(processedExpense)
}

const run = async () => {
    console.log(`Expense Server: ${EXPENSE_SERVER}`);
    // Process expenses for AG01 home group
    // const { expenses } = await getExpenseForGroup(GROUPIDS.AG01V3Group)
    // console.log("Expenses to process:", expenses.length);
    // const processedExpense = await processExpensesForBudgetApp(expenses)
    // console.log(processedExpense);
    // await sendExpenseEntries(processedExpense)

    // Process expenses for the 3D Printing Group
    await processGroupExpenses(GROUPIDS.AG01V3Group, "AG01 V3")

    // Process expenses for the 3D Printing Group
    await processGroupExpenses(GROUPIDS.Printing3DGroup, "3D Printing")

    await processGroupExpenses(GROUPIDS.PragiBachelorette, "Pragi Bachelorette")

};


run();
