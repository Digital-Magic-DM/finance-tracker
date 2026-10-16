// Unit tests for financial calculations & edge cases

console.log('🧪 Testing Financial Calculation Logic & Edge Cases...\n');

let passed = 0;
let total = 0;

function assert(condition, name) {
  total++;
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}`);
    process.exitCode = 1;
  }
}

// 1. Test Zero Invested / Empty Portfolio
{
  const totalCurrentValue = 0;
  const totalInvested = 0;
  const totalProfit = totalCurrentValue - totalInvested;
  const profitPercentage = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

  assert(!isNaN(profitPercentage), 'Zero invested capital does not produce NaN');
  assert(isFinite(profitPercentage), 'Zero invested capital does not produce Infinity');
  assert(profitPercentage === 0, 'Zero invested capital returns 0% profit');
}

// 2. Test Asset Allocation Percentage Calculation
{
  const totalCurrentValue = 100000;
  const breakdown = {
    Stock: { value: 60000, percentage: 0, count: 2 },
    MutualFund: { value: 30000, percentage: 0, count: 1 },
    Cash: { value: 10000, percentage: 0, count: 1 },
  };

  for (const key of Object.keys(breakdown)) {
    breakdown[key].percentage =
      totalCurrentValue > 0 ? (breakdown[key].value / totalCurrentValue) * 100 : 0;
    breakdown[key].percentage = Math.round(breakdown[key].percentage * 10) / 10;
  }

  assert(breakdown.Stock.percentage === 60, 'Stock allocation calculated correctly (60%)');
  assert(breakdown.MutualFund.percentage === 30, 'Mutual Fund allocation calculated correctly (30%)');
  assert(breakdown.Cash.percentage === 10, 'Cash allocation calculated correctly (10%)');
}

// 3. Test Cash Flow with 0 Income (100% burn rate, no division by zero)
{
  const totalIncome = 0;
  const totalExpense = 45000;
  const netSavings = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;

  assert(!isNaN(savingsRate), 'Zero income does not produce NaN savings rate');
  assert(savingsRate === 0, 'Zero income returns 0% savings rate safely');
  assert(netSavings === -45000, 'Net savings correctly reflects deficit (-45,000)');
}

// 4. Test Cash Flow with Surplus Income
{
  const totalIncome = 100000;
  const totalExpense = 40000;
  const netSavings = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;

  assert(netSavings === 60000, 'Net surplus correctly calculated (+60,000)');
  assert(savingsRate === 60, 'Savings rate correctly calculated (60%)');
}

// 5. Test Emergency Runway Calculation
{
  const liquidNetWorth = 300000;
  const avgMonthlyBurn = 50000;
  const runwayMonths = avgMonthlyBurn > 0 ? Math.round((liquidNetWorth / avgMonthlyBurn) * 10) / 10 : 0;

  assert(runwayMonths === 6, 'Runway correctly calculated as 6.0 months');

  let status = 'critical';
  if (runwayMonths >= 6) status = 'safe';
  else if (runwayMonths >= 3) status = 'adequate';

  assert(status === 'safe', '6 months runway correctly evaluated as "safe"');
}

// 6. Test Zero Monthly Burn Emergency Runway
{
  const liquidNetWorth = 150000;
  const avgMonthlyBurn = 0;
  const runwayMonths = avgMonthlyBurn > 0 ? Math.round((liquidNetWorth / avgMonthlyBurn) * 10) / 10 : 0;

  assert(!isNaN(runwayMonths), 'Zero burn rate does not produce NaN');
  assert(runwayMonths === 0, 'Zero burn rate returns 0 cleanly');
}

console.log(`\nResults: ${passed} / ${total} calculation tests passed! 🎉\n`);
