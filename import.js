import fetch from "node-fetch";
import moment from "moment";
import dotenv from "dotenv"

dotenv.config()

const APIKEY = process.env.SPLITWISE_API_KEY; // Bearer auth
const USERID = 23804942
const GROUPIDS = {
    AG01V3Group: "56584765"
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
            console.log(rawResponse);
            const content = await rawResponse.json();
            console.log(content);
        } catch (e) {
            console.log("Insert expense error.", e);
        }
    }
}

const run = async () => {
    // const userData = await getUser()
    // console.log(userData);
    // const groups = await getGroups();
    // console.log(groups);
    const { expenses } = await getExpenseForGroup(GROUPIDS.AG01V3Group)
    // const expenses = expenseResp.expenses
    console.log("Expenses to process:", expenses.length);
    const processedExpense = await processExpensesForBudgetApp(expenses)
    console.log(processedExpense);
    await sendExpenseEntries(processedExpense)

};


run();
