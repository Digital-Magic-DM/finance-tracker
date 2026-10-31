export type GoalCategory =
  | 'Retirement'
  | 'Home'
  | 'Education'
  | 'Vehicle'
  | 'Travel'
  | 'Wealth'
  | 'Emergency'
  | 'Family'
  | 'Other';

export interface GoalCategoryConfig {
  label: string;
  icon: string;
  color: string;
  defaultTimeframeYears: number;
}

export const GOAL_CATEGORY_CONFIG: Record<GoalCategory, GoalCategoryConfig> = {
  Retirement: { label: 'Retirement', icon: 'beach_access', color: '#10b981', defaultTimeframeYears: 20 },
  Home: { label: 'Dream Home', icon: 'home', color: '#3b82f6', defaultTimeframeYears: 7 },
  Education: { label: 'Higher Education', icon: 'school', color: '#8b5cf6', defaultTimeframeYears: 10 },
  Vehicle: { label: 'Car / Vehicle', icon: 'directions_car', color: '#f59e0b', defaultTimeframeYears: 3 },
  Travel: { label: 'Vacation & Travel', icon: 'flight_takeoff', color: '#ec4899', defaultTimeframeYears: 2 },
  Wealth: { label: 'Financial Freedom', icon: 'diamond', color: '#06b6d4', defaultTimeframeYears: 15 },
  Emergency: { label: 'Emergency Fund', icon: 'health_and_safety', color: '#14b8a6', defaultTimeframeYears: 1 },
  Family: { label: 'Family & Marriage', icon: 'favorite', color: '#f97316', defaultTimeframeYears: 5 },
  Other: { label: 'Custom Goal', icon: 'flag', color: '#64748b', defaultTimeframeYears: 3 },
};

export interface Goal {
  id: string;
  name: string;
  category: GoalCategory;
  targetAmount: number;
  targetDate: string; // YYYY-MM-DD
  priority: 'High' | 'Medium' | 'Low';
  notes?: string;
  manualContribution?: number; // Manual or external one-time cash savings
  color?: string;
  icon?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface GoalSummaryMetrics {
  totalGoals: number;
  activeGoals: number;
  achievedGoals: number;
  totalTargetAmount: number;
  totalAccumulatedAmount: number;
  overallProgressPct: number;
  totalMonthlySipAllocated: number;
}

export interface GoalWithProgress extends Goal {
  currentAmount: number;
  progressPct: number;
  remainingAmount: number;
  monthlySipAmount: number;
  monthsRemaining: number;
  requiredMonthlySavings: number;
  isOnTrack: boolean;
  status: 'In Progress' | 'Achieved' | 'Needs Boost';
  mappedAssetsCount: number;
  mappedSipsCount: number;
  mappedAssetNames: string[];
  mappedSipNames: string[];
}
