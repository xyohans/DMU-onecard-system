export type MealType = 'breakfast' | 'lunch' | 'dinner';

export type Student = {
  id: string;
  full_name: string;
  department: string | null;
  photo_url: string | null;
  is_active: number;
};

export type Meal = {
  meal_type: MealType;
  date: string;
  menu_name: string | null;
};

export type ScanStatus =
  | 'ALLOWED'
  | 'ALREADY_USED'
  | 'CLOSED'
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'BAD_REQUEST'
  | 'ERROR'
  | 'NETWORK';

export type ScanResult = {
  status: ScanStatus;
  student?: Student;
  meal?: Meal;
  firstScan?: { scanned_at: string } | null;
};

export type MealWindow = {
  meal_type: MealType;
  start_time: string;
  end_time: string;
};

export type StatusResponse = {
  date: string;
  serverTime: string;
  open: boolean;
  current: (MealWindow & { menu_name: string | null }) | null;
  next: MealWindow | null;
  schedule: MealWindow[];
};