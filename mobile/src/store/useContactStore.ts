import { create } from 'zustand';
import { getItem, setItem, StorageKeys } from '../utils/storage';

export interface ContactInfo {
  name: string;
  lastTransactionDate?: string;
  totalBalance?: number;
}

interface ContactState {
  contacts: ContactInfo[];
  addContact: (name: string, date?: string, balance?: number) => Promise<void>;
  removeContact: (name: string) => Promise<void>;
  updateContact: (name: string, data: Partial<ContactInfo>) => Promise<void>;
  hydrateContacts: () => Promise<void>;
}

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],
  hydrateContacts: async () => {
    try {
      const stored = await getItem(StorageKeys.CONTACTS);
      if (stored) {
        set({ contacts: JSON.parse(stored) });
      }
    } catch {
      set({ contacts: [] });
    }
  },
  
  addContact: async (name: string, date?: string, balance?: number) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    
    const { contacts } = get();
    const existingIndex = contacts.findIndex((c) => c.name === trimmedName);
    
    let updated: ContactInfo[];
    if (existingIndex >= 0) {
      updated = [...contacts];
      updated[existingIndex] = {
        ...updated[existingIndex],
        ...(date ? { lastTransactionDate: date } : {}),
        ...(balance !== undefined ? { totalBalance: balance } : {})
      };
    } else {
      updated = [...contacts, { name: trimmedName, lastTransactionDate: date, totalBalance: balance }];
    }
    
    await setItem(StorageKeys.CONTACTS, JSON.stringify(updated));
    set({ contacts: updated });
  },

  updateContact: async (name: string, data: Partial<ContactInfo>) => {
    const updated = get().contacts.map((c) => 
      c.name === name ? { ...c, ...data } : c
    );
    await setItem(StorageKeys.CONTACTS, JSON.stringify(updated));
    set({ contacts: updated });
  },

  removeContact: async (name: string) => {
    const updated = get().contacts.filter((contact) => contact.name !== name);
    await setItem(StorageKeys.CONTACTS, JSON.stringify(updated));
    set({ contacts: updated });
  },
}));
