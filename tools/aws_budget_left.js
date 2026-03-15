import dotenv from "dotenv";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { BudgetsClient, DescribeBudgetsCommand } from "@aws-sdk/client-budgets";

dotenv.config({ path: ".env.local" });

function fmtMoney(amount, unit) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return String(amount);
  const currency = unit || "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { budgetName: null, region: process.env.AWS_REGION || "us-east-1" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--budget" || a === "--name") out.budgetName = args[i + 1] || null;
    if (a.startsWith("--budget=") || a.startsWith("--name=")) out.budgetName = a.split("=", 2)[1] || null;
    if (a === "--region") out.region = args[i + 1] || out.region;
    if (a.startsWith("--region=")) out.region = a.split("=", 2)[1] || out.region;
  }
  if (!out.budgetName && process.env.AWS_BUDGET_NAME) out.budgetName = process.env.AWS_BUDGET_NAME;
  return out;
}

async function getAccountId(region) {
  const sts = new STSClient({ region });
  const res = await sts.send(new GetCallerIdentityCommand({}));
  return res.Account;
}

async function listAllBudgets(region, accountId) {
  const budgets = new BudgetsClient({ region });
  const all = [];
  let nextToken = undefined;
  do {
    const res = await budgets.send(new DescribeBudgetsCommand({
      AccountId: accountId,
      NextToken: nextToken,
      MaxResults: 100,
    }));
    all.push(...(res.Budgets || []));
    nextToken = res.NextToken;
  } while (nextToken);
  return all;
}

function summarizeBudget(b) {
  const name = b.BudgetName || "(unnamed)";
  const type = b.BudgetType || "UNKNOWN";
  const timeUnit = b.TimeUnit || "UNKNOWN";
  const limit = b.BudgetLimit;
  const actual = b.CalculatedSpend?.ActualSpend;
  const forecast = b.CalculatedSpend?.ForecastedSpend;

  const limitN = toNum(limit?.Amount);
  const actualN = toNum(actual?.Amount);
  const remainingN = (limitN != null && actualN != null) ? limitN - actualN : null;

  const unit = limit?.Unit || actual?.Unit || forecast?.Unit || "USD";
  const tp = b.TimePeriod || {};
  const start = tp.Start ? new Date(tp.Start).toISOString().slice(0, 10) : null;
  const end = tp.End ? new Date(tp.End).toISOString().slice(0, 10) : null;

  return {
    name,
    type,
    timeUnit,
    period: start && end ? `${start}..${end}` : null,
    limit: limit?.Amount != null ? fmtMoney(limit.Amount, unit) : null,
    actual: actual?.Amount != null ? fmtMoney(actual.Amount, unit) : null,
    forecast: forecast?.Amount != null ? fmtMoney(forecast.Amount, unit) : null,
    remaining: remainingN != null ? fmtMoney(remainingN, unit) : null,
    _remainingN: remainingN,
  };
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log("No budgets found.");
    return;
  }

  for (const r of rows) {
    const parts = [
      `Budget: ${r.name}`,
      `Type: ${r.type}`,
      `TimeUnit: ${r.timeUnit}`,
    ];
    if (r.period) parts.push(`Period: ${r.period}`);
    if (r.limit) parts.push(`Limit: ${r.limit}`);
    if (r.actual) parts.push(`Actual: ${r.actual}`);
    if (r.remaining) parts.push(`Left: ${r.remaining}`);
    if (r.forecast) parts.push(`Forecast: ${r.forecast}`);
    console.log(parts.join(" | "));
  }
}

async function main() {
  const { budgetName, region } = parseArgs();

  try {
    const accountId = await getAccountId(region);
    if (!accountId) throw new Error("Unable to resolve AWS account id (STS GetCallerIdentity returned empty Account).");

    const budgets = await listAllBudgets(region, accountId);
    const summarized = budgets.map(summarizeBudget);

    const filtered = budgetName
      ? summarized.filter((b) => b.name.toLowerCase() === budgetName.toLowerCase())
      : summarized;

    if (budgetName && filtered.length === 0) {
      console.error(`No budget matched name "${budgetName}". Available budgets:`);
      printTable(summarized);
      process.exitCode = 2;
      return;
    }

    // Put the lowest remaining at the bottom; keep unknowns last.
    filtered.sort((a, b) => {
      const ax = a._remainingN;
      const bx = b._remainingN;
      if (ax == null && bx == null) return a.name.localeCompare(b.name);
      if (ax == null) return 1;
      if (bx == null) return -1;
      return bx - ax;
    });

    printTable(filtered);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`Failed to fetch AWS Budgets: ${msg}`);
    console.error("Likely causes:");
    console.error("- Missing permissions: budgets:ViewBudget / budgets:DescribeBudgets");
    console.error("- Credentials expired (AWS_SESSION_TOKEN in .env.local)");
    console.error("- Budgets is a global-ish service; try --region us-east-1");
    process.exitCode = 1;
  }
}

main();

