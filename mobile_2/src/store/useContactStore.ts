import { create } from 'zustand';

export interface ContactInfo {
  name: string;
  lastTransactionDate?: string;
  totalBalance?: number;
}

interface ContactState {
  contacts: ContactInfo[];
  addContact: (name: string, date?: string, balance?: number) => void;
  removeContact: (name: string) => void;
  updateContact: (name: string, data: Partial<ContactInfo>) => void;
}

export const useContactStore = create<ContactState>((set) => ({
  contacts: [],
  
  addContact: (name: string, date?: string, balance?: number) => set((state) => {
    const trimmedName = name.trim();
    if (!trimmedName) return state;
    
    const existingIndex = state.contacts.findIndex((c) => c.name === trimmedName);
    
    if (existingIndex >= 0) {
      const updated = [...state.contacts];
      updated[existingIndex] = {
        ...updated[existingIndex],
        ...(date ? { lastTransactionDate: date } : {}),
        ...(balance !== undefined ? { totalBalance: balance } : {})
      };
      return { contacts: updated };
    }
    
    return {
      contacts: [...state.contacts, { name: trimmedName, lastTransactionDate: date, totalBalance: balance }]
    };
  }),

  updateContact: (name: string, data: Partial<ContactInfo>) => set((state) => ({
    contacts: state.contacts.map((c) => 
      c.name === name ? { ...c, ...data } : c
    )
  })),

  removeContact: (name: string) => set((state) => ({
    contacts: state.contacts.filter((contact) => contact.name !== name)
  })),
}));
