import { create } from 'zustand';
import { getDirectory, createEntry, updateEntry, deleteEntry, DirectoryEntry } from '../api/directoryService';

export interface ContactInfo {
  id: string;
  name: string;
  lastTransactionDate?: string;
  totalBalance?: number;
}

interface ContactState {
  contacts: ContactInfo[];
  addContact: (name: string, date?: string, balance?: number) => Promise<void>;
  removeContact: (id: string) => Promise<void>;
  updateContact: (id: string, data: Partial<ContactInfo>) => Promise<void>;
  fetchContacts: () => Promise<void>;
}

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],
  
  fetchContacts: async () => {
    try {
      const data = await getDirectory('CONTACT');
      set({ contacts: data.map(d => ({ id: d._id, name: d.name, totalBalance: d.totalBalance, lastTransactionDate: d.lastTransactionDate })) });
    } catch (error) {
      console.error('[useContactStore.fetchContacts]', error);
    }
  },
  
  addContact: async (name: string, date?: string, balance?: number) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    
    const { contacts } = get();
    // Try to find locally first to avoid unnecessary requests if exact match
    if (contacts.find((c) => c.name.toLowerCase() === trimmedName.toLowerCase())) {
      return;
    }
    
    try {
      const newEntry = await createEntry({ name: trimmedName, type: 'CONTACT', lastTransactionDate: date, totalBalance: balance });
      set({ contacts: [...contacts, { id: newEntry._id, name: newEntry.name, totalBalance: newEntry.totalBalance, lastTransactionDate: newEntry.lastTransactionDate }] });
    } catch (error) {
      console.error('[useContactStore.addContact]', error);
    }
  },

  updateContact: async (id: string, data: Partial<ContactInfo>) => {
    try {
      await updateEntry(id, data);
      const updated = get().contacts.map((c) => 
        c.id === id ? { ...c, ...data } : c
      );
      set({ contacts: updated });
    } catch (error) {
      console.error('[useContactStore.updateContact]', error);
    }
  },

  removeContact: async (id: string) => {
    try {
      await deleteEntry(id);
      const updated = get().contacts.filter((contact) => contact.id !== id);
      set({ contacts: updated });
    } catch (error) {
      console.error('[useContactStore.removeContact]', error);
    }
  },
}));
