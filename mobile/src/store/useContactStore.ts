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
  isLoading: boolean;
  addContact: (name: string, date?: string, balance?: number) => Promise<void>;
  removeContact: (id: string) => Promise<void>;
  updateContact: (id: string, data: Partial<ContactInfo>) => Promise<void>;
  fetchContacts: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  contacts: [],
  isLoading: false,
};

export const useContactStore = create<ContactState>((set, get) => ({
  ...initialState,
  
  fetchContacts: async () => {
    set({ isLoading: true });
    try {
      // Sadece 'CONTACT' tipindeki rehber girişlerini çekiyoruz
      const data = await getDirectory('CONTACT');
      set({ 
        contacts: data.map(d => ({ 
          id: d._id, 
          name: d.name, 
          totalBalance: d.totalBalance, 
          lastTransactionDate: d.lastTransactionDate 
        })),
        isLoading: false 
      });
    } catch (error) {
      console.error('[useContactStore.fetchContacts]', error);
      set({ isLoading: false });
    }
  },
  
  addContact: async (name: string, date?: string, balance?: number) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    
    const { contacts } = get();
    // Unique check (case insensitive)
    if (contacts.some((c) => c.name.toLocaleLowerCase('tr').trim() === trimmedName.toLocaleLowerCase('tr').trim())) {
      throw new Error('Bu isimde bir kişi zaten kayıtlı.');
    }
    
    try {
      const newEntry = await createEntry({ name: trimmedName, type: 'CONTACT', lastTransactionDate: date, totalBalance: balance });
      set({ contacts: [...contacts, { id: newEntry._id, name: newEntry.name, totalBalance: newEntry.totalBalance, lastTransactionDate: newEntry.lastTransactionDate }] });
    } catch (error) {
      console.error('[useContactStore.addContact]', error);
      throw error;
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

  reset: () => set(initialState),
}));
