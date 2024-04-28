import fetch from "node-fetch";
import moment from "moment";
import dotenv from "dotenv"
import fs from "fs"

dotenv.config()

const APIKEY = process.env.SPLITWISE_API_KEY; // Bearer auth
const USERID = 23804942
const GROUPIDS = {
    AG01V3Group: "56584765"
}

const callApi = async (endpoint, body) => {
    let resp = await fetch(`https://secure.splitwise.com/api/v3.0/${endpoint}?` + new URLSearchParams(body), {
        headers: { Authorization: `Bearer ${APIKEY}` },
    });
    // console.log(resp);
    resp = await resp.json();
    return resp
}

const getGroups = async () => {
    const groupsData = await callApi("get_groups")
    fs.writeFileSync("groups.json", JSON.stringify(groupsData.groups, null, 4))
}

getGroups()