import React from 'react';
import { CalendarIcon, ArrowTrendingUpIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceDot, ReferenceArea } from 'recharts';

// Mock data for summary boxes
const totalContracts = 42;
const percentageAfterMeeting = 78; // %
const totalBalance = 320000; // NIS

// Mock data for My Performance graph (last 30 days)
const today = new Date();
const daysArray = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(today);
  d.setDate(today.getDate() - (29 - i));
  return d;
});
const performanceData = daysArray.map((date, i) => ({
  date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  count: Math.floor(Math.random() * 5) + (date.getDate() === today.getDate() ? 5 : 1),
  isToday: date.toDateString() === today.toDateString(),
  isThisMonth: date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear(),
}));
const teamAverageData = daysArray.map((date, i) => ({
  date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  avg: 3 + Math.sin(i / 5) * 1.5
}));

// Mock data for signed leads (last 30 days)
const signedLeads = daysArray.map((d, i) => ({
  id: `L${10000 + i}`,
  clientName: [
    'David Lee', 'Emma Wilson', 'Noah Cohen', 'Olivia Levi', 'Liam Katz',
    'Maya Gold', 'Ethan Weiss', 'Sophie Adler', 'Daniel Stern', 'Ella Rubin',
    'Ava Berger', 'Ben Shalev', 'Mia Rosen', 'Leo Friedman', 'Zoe Klein',
    'Sara Weiss', 'Jonah Adler', 'Lily Stern', 'Max Rubin', 'Nina Berger',
    'Adam Shalev', 'Tamar Rosen', 'Oren Friedman', 'Shira Klein', 'Eli Weiss',
    'Noa Adler', 'Amit Stern', 'Lior Rubin', 'Dana Berger', 'Yarden Shalev'
  ][i % 30],
  date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  amount: Math.floor(Math.random() * 8000) + 2000,
  category: ['German Citizenship', 'Austrian Citizenship', 'Business Visa', 'Family Reunification', 'Other'][i % 5],
  topic: [
    'Citizenship', 'Visa', 'Family Reunification', 'Business', 'Other'
  ][i % 5],
  expert: [
    'Dr. Cohen', 'Adv. Levi', 'Ms. Katz', 'Mr. Gold', 'Dr. Weiss'
  ][i % 5],
  leadNumber: `L${10000 + i}`,
}));

const contractsToday = performanceData.find(d => d.isToday)?.count || 0;
const contractsThisMonth = performanceData.filter(d => d.isThisMonth).reduce((sum, d) => sum + d.count, 0);
const contractsLast30 = performanceData.reduce((sum, d) => sum + d.count, 0);

const PerformanceTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
  if (!active || !payload || payload.length === 0) return null;
  const teamAvgObj = teamAverageData.find(d => d.date === label);
  const teamAvg = teamAvgObj ? Math.ceil(teamAvgObj.avg) : null;
  const myContractsObj = performanceData.find(d => d.date === label);
  const myContracts = myContractsObj ? myContractsObj.count : null;
  return (
    <div style={{ background: 'rgba(0,0,0,0.8)', borderRadius: 12, color: '#fff', padding: 12, minWidth: 120 }}>
      <div className="font-bold mb-1">{label}</div>
      {myContracts !== null && (
        <div>Contracts: {myContracts} contracts</div>
      )}
      {teamAvg !== null && (
        <div>Team Avg: {teamAvg} contracts</div>
      )}
    </div>
  );
};

const MyPerformancePage: React.FC = () => {
  const [showLeadsList, setShowLeadsList] = React.useState(false);
  return (
    <div className="p-6 space-y-10">
      {/* Top Summary Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 w-full mt-6">
        {/* Total Contracts Signed */}
        <div className="rounded-2xl transition-all duration-300 shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden p-6 cursor-pointer hover:scale-[1.03] hover:shadow-2xl">
          <div className="flex items-center gap-4">
            <ChartBarIcon className="w-8 h-8 text-white opacity-90" />
            <div>
              <div className="text-3xl font-extrabold text-white leading-tight">{totalContracts}</div>
              <div className="text-white/80 text-base font-medium mt-1">Total Contracts Signed</div>
            </div>
          </div>
        </div>
        {/* Percentage contracts signed after meeting */}
        <div className="rounded-2xl transition-all duration-300 shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden p-6 cursor-pointer hover:scale-[1.03] hover:shadow-2xl">
          <div className="flex items-center gap-4">
            <ArrowTrendingUpIcon className="w-8 h-8 text-white opacity-90" />
            <div>
              <div className="text-3xl font-extrabold text-white leading-tight">{percentageAfterMeeting}%</div>
              <div className="text-white/80 text-base font-medium mt-1">Signed After Meeting</div>
            </div>
          </div>
        </div>
        {/* Total balance amount this month */}
        <div className="rounded-2xl transition-all duration-300 shadow-xl bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white relative overflow-hidden p-6 cursor-pointer hover:scale-[1.03] hover:shadow-2xl">
          <div className="flex items-center gap-4">
            <CalendarIcon className="w-8 h-8 text-white opacity-90" />
            <div>
              <div className="text-3xl font-extrabold text-white leading-tight">₪{totalBalance.toLocaleString()}</div>
              <div className="text-white/80 text-base font-medium mt-1">Total Balance This Month</div>
            </div>
          </div>
        </div>
      </div>

      {/* My Performance Graph/Box */}
      <div className="w-full">
        <div className="rounded-3xl p-0.5 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400">
          <div className="card shadow-xl rounded-3xl w-full max-w-full relative overflow-hidden bg-white">
            <div className="card-body p-8">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex items-center justify-center w-12 h-12 rounded-full shadow bg-white">
                    <ChartBarIcon className="w-7 h-7 text-purple-700" />
                  </div>
                  <span className="text-2xl font-bold text-gray-900">My Performance</span>
                </div>
                <div className="flex gap-6 text-sm md:text-base items-center">
                  <div className="flex flex-col items-center">
                    <span className="font-bold text-gray-900 text-xl">{contractsLast30}</span>
                    <span className="text-gray-500">Last 30 Days</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="font-bold text-gray-900 text-xl">{contractsToday}</span>
                    <span className="text-gray-500">Today</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="font-bold text-gray-900 text-xl">{contractsThisMonth}</span>
                    <span className="text-gray-500">This Month</span>
                  </div>
                  {/* View Leads Button */}
                  <button
                    className="btn btn-sm btn-outline border-gray-300 text-gray-700 hover:bg-gray-100 ml-2"
                    onClick={() => setShowLeadsList((v) => !v)}
                  >
                    {showLeadsList ? 'Hide Leads' : 'View Leads'}
                  </button>
                </div>
              </div>
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={performanceData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#222' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#222' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} width={30} />
                    <Tooltip content={<PerformanceTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#3b28c7"
                      strokeWidth={3}
                      dot={{ r: 5, stroke: '#3b28c7', strokeWidth: 2, fill: '#fff' }}
                      activeDot={{ r: 8, fill: '#3b28c7', stroke: '#000', strokeWidth: 3 }}
                      name="My Contracts"
                    />
                    <Line
                      type="monotone"
                      data={teamAverageData}
                      dataKey="avg"
                      stroke="#06b6d4"
                      strokeWidth={3}
                      dot={false}
                      name="Team Avg"
                      strokeDasharray="6 6"
                    />
                    {/* Highlight today */}
                    {performanceData.map((d, i) => d.isToday && (
                      <ReferenceDot key={i} x={d.date} y={d.count} r={10} fill="#3b28c7" stroke="#000" strokeWidth={3} />
                    ))}
                    {/* Highlight this month */}
                    {(() => {
                      const first = performanceData.findIndex(d => d.isThisMonth);
                      const last = performanceData.map(d => d.isThisMonth).lastIndexOf(true);
                      if (first !== -1 && last !== -1 && last > first) {
                        return (
                          <ReferenceArea x1={performanceData[first].date} x2={performanceData[last].date} fill="#3b28c7" fillOpacity={0.07} />
                        );
                      }
                      return null;
                    })()}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Legend for My Contracts and Team Avg */}
              <div className="flex gap-6 mt-4 items-center">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-6 h-2 rounded-full" style={{background:'#3b28c7'}}></span>
                  <span className="text-base font-semibold text-gray-900">My Contracts</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-6 h-2 rounded-full" style={{background:'#06b6d4'}}></span>
                  <span className="text-base font-semibold text-gray-900">Team Avg</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Signed Leads List Below Performance Box */}
      {showLeadsList && (
        <div className="glass-card mt-6 p-6 shadow-lg rounded-2xl w-full max-w-full animate-fade-in">
          <div className="font-bold text-lg mb-4 text-base-content/80">Signed Leads (Last 30 Days)</div>
          <div className="overflow-x-auto">
            <table className="table w-full text-lg">
              <thead>
                <tr>
                  <th className="font-bold text-xl px-0 py-3">Lead</th>
                  <th className="font-bold text-xl px-0 py-3">Topic</th>
                  <th className="font-bold text-xl px-0 py-3">Expert</th>
                  <th className="font-bold text-xl px-0 py-3">Amount</th>
                  <th className="font-bold text-xl px-0 py-3">Signed Date</th>
                </tr>
              </thead>
              <tbody>
                {signedLeads.slice().reverse().map((lead, idx) => (
                  <tr
                    key={lead.id}
                    className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} transition-all duration-150 hover:bg-gray-200`}
                  >
                    <td className="px-0 py-3 text-primary whitespace-nowrap">
                      <span className="font-bold">{lead.leadNumber}</span>
                      <span className="text-black font-normal ml-2">- {lead.clientName}</span>
                    </td>
                    <td className="px-0 py-3"><span className="badge badge-outline">{lead.topic}</span></td>
                    <td className="px-0 py-3 text-base-content/80 whitespace-nowrap">{lead.expert}</td>
                    <td className="px-0 py-3 text-success font-bold whitespace-nowrap">₪{lead.amount.toLocaleString()}</td>
                    <td className="px-0 py-3 text-base-content/80 whitespace-nowrap">{lead.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyPerformancePage; 