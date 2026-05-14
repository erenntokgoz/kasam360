import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Employee {
  id: string;
  name: string;
  role: string;
  salary: number;
  startDate: string;
  expenses: EmployeeExpense[];
  salaries: SalaryPayment[];
}

export interface EmployeeExpense {
  id: string;
  description: string;
  amount: number;
  date: string;
}

export interface SalaryPayment {
  id: string;
  amount: number;
  date: string;
  month: string;
}

interface EmployeeState {
  employees: Employee[];
  isLoading: boolean;
  error: string | null;
  fetchEmployees: () => Promise<void>;
  addEmployee: (employee: Omit<Employee, 'id' | 'expenses' | 'salaries'>) => Promise<void>;
  updateEmployee: (id: string, updates: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;
  addExpense: (employeeId: string, expense: Omit<EmployeeExpense, 'id'>) => Promise<void>;
  addSalaryPayment: (employeeId: string, payment: Omit<SalaryPayment, 'id'>) => Promise<void>;
}

// Mock data for initial state to demonstrate UI
const mockEmployees: Employee[] = [
  {
    id: '1',
    name: 'Ahmet Yılmaz',
    role: 'Geliştirici',
    salary: 45000,
    startDate: '2025-01-15',
    expenses: [
      { id: '101', description: 'Yol masrafı', amount: 500, date: '2026-05-10' },
      { id: '102', description: 'Yemek', amount: 300, date: '2026-05-12' },
    ],
    salaries: [
      { id: '201', amount: 45000, date: '2026-04-30', month: 'Nisan 2026' },
      { id: '202', amount: 45000, date: '2026-03-31', month: 'Mart 2026' },
    ],
  },
  {
    id: '2',
    name: 'Ayşe Demir',
    role: 'Tasarımcı',
    salary: 40000,
    startDate: '2025-03-01',
    expenses: [
      { id: '103', description: 'Yazılım lisansı', amount: 1200, date: '2026-05-01' },
    ],
    salaries: [
      { id: '203', amount: 40000, date: '2026-04-30', month: 'Nisan 2026' },
    ],
  },
];

export const useEmployeeStore = create<EmployeeState>()(
  persist(
    (set, get) => ({
      employees: mockEmployees,
      isLoading: false,
      error: null,

      fetchEmployees: async () => {
        set({ isLoading: true });
        // In real app: const data = await api.getEmployees();
        // For now, we use persisted mock data
        set({ isLoading: false });
      },

      addEmployee: async (employeeData) => {
        const newEmployee: Employee = {
          ...employeeData,
          id: Math.random().toString(36).substr(2, 9),
          expenses: [],
          salaries: [],
        };
        set((state) => ({
          employees: [...state.employees, newEmployee],
        }));
      },

      updateEmployee: async (id, updates) => {
        set((state) => ({
          employees: state.employees.map((emp) =>
            emp.id === id ? { ...emp, ...updates } : emp
          ),
        }));
      },

      deleteEmployee: async (id) => {
        set((state) => ({
          employees: state.employees.filter((emp) => emp.id !== id),
        }));
      },

      addExpense: async (employeeId, expenseData) => {
        const newExpense: EmployeeExpense = {
          ...expenseData,
          id: Math.random().toString(36).substr(2, 9),
        };
        set((state) => ({
          employees: state.employees.map((emp) =>
            emp.id === employeeId
              ? { ...emp, expenses: [newExpense, ...emp.expenses] }
              : emp
          ),
        }));
      },

      addSalaryPayment: async (employeeId, paymentData) => {
        const newPayment: SalaryPayment = {
          ...paymentData,
          id: Math.random().toString(36).substr(2, 9),
        };
        set((state) => ({
          employees: state.employees.map((emp) =>
            emp.id === employeeId
              ? { ...emp, salaries: [newPayment, ...emp.salaries] }
              : emp
          ),
        }));
      },
    }),
    {
      name: 'employee-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
