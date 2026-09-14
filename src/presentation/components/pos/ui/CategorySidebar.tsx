import { POSCategory } from '../../../types';

interface CategorySidebarProps {
  categories: POSCategory[];
  activeCategory: string;
  onSelect: (categoryId: string) => void;
}

export function CategorySidebar({ categories, activeCategory, onSelect }: CategorySidebarProps) {
  return (
    <div className="flex h-full w-56 flex-col overflow-y-auto bg-slate-900 border-r border-slate-800">
      <button
        onClick={() => onSelect('favorites')}
        className={`px-4 py-4 text-left transition-colors ${
          activeCategory === 'favorites'
            ? 'border-l-4 border-emerald-500 bg-slate-800 font-bold text-emerald-400'
            : 'border-l-4 border-transparent text-slate-300 hover:bg-slate-800'
        }`}
      >
        ★ Favoriler
      </button>
      
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelect(category.id)}
          className={`px-4 py-4 text-left transition-colors ${
            activeCategory === category.id
              ? 'border-l-4 border-emerald-500 bg-slate-800 font-bold text-emerald-400'
              : 'border-l-4 border-transparent text-slate-300 hover:bg-slate-800'
          }`}
        >
          {category.name}
        </button>
      ))}
    </div>
  );
}
