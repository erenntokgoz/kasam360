// Menu360 modülü tip tanımları
// Tüm para alanları INTEGER kuruş (cents) cinsindendir.

export interface ProductDto {
  id: string;
  categoryId: string;
  name: string;
  priceCents: number;
  imageUrl?: string;
  isActive: boolean;
  sku?: string;
  barcode?: string;
  taxRateBp?: number;
  description?: string;
  color?: string;
  is86: boolean;
  stockoutReason?: string;
  stockUnit?: string;
  defaultStation?: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  displayOrder: number;
  icon?: string;
  defaultStation: string;
}

export interface ModifierOptionDto {
  id: string;
  modifierGroupId?: string;
  name: string;
  priceCents: number;
  priceDeltaCents?: number;
  displayOrder?: number;
}

export interface ModifierGroupDto {
  id: string;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  categoryId?: string;
  options: ModifierOptionDto[];
}

export interface PriceListItemDto {
  id: string;
  priceListId: string;
  productId: string;
  priceCents: number;
}

export interface PriceListDto {
  id: string;
  name: string;
  kind?: string;
  description?: string;
  isActive?: boolean;
  validFrom?: string;
  validTo?: string;
  items?: PriceListItemDto[];
}

export interface BulkPriceInput {
  updateType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number; // Yüzde için baz puan (1250 = %12,5), TL için kuruş
  categoryId?: string;
}

export interface BulkPriceChange {
  productId: string;
  productName: string;
  oldPriceCents: number;
  newPriceCents: number;
}

export interface BulkPriceResult {
  changed: BulkPriceChange[] | number;
  skipped: BulkPriceChange[] | number;
  categoryId?: string;
}

export interface RecipeCostItemDto {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  unitCostCents: number | null;
  lineCostCents: number | null;
}

export interface RecipeCostDto {
  recipeId: string;
  productId: string;
  totalCostCents: number | null;
  items: RecipeCostItemDto[];
  unresolvedCount: number;
}

export interface RecipeInputDto {
  productId: string;
  name: string;
  yieldPercent: number;
  outputQuantity: number;
  outputUnit: string;
  notes: string | null;
  items: Array<{
    componentProductId: string;
    quantity: number;
    unit: string;
    wastePercent: number;
    notes: string | null;
  }>;
}

export interface Menu360BulkPreviewItem {
  id: string;
  name: string;
  oldPriceCents: number;
  newPriceCents: number;
}

export interface Menu360State {
  products: ProductDto[];
  categories: CategoryDto[];
  modifierGroups: ModifierGroupDto[];
  productModifierGroupIds: string[];
  modifierGroupsLoading: boolean;
  priceLists: PriceListDto[];
  selectedProductId: string | null;
  detailMode: 'view' | 'new';
  activeTab: 'KATALOG' | 'FIYATLAR';
  detailTab: 'temel' | 'modifiye' | 'fiyat' | 'recete';
  searchQuery: string;
  filters: {
    tukendi: boolean;
    satista: boolean;
    categoryId: string | null;
  };
  busy: boolean;
  error: string | null;
  productRecipe: RecipeCostDto | null;
  bulkPreview: Menu360BulkPreviewItem[];

  // Aksiyonlar
  loadCatalog: () => Promise<void>;
  setSelectedProductId: (id: string | null) => void;
  setDetailMode: (mode: 'view' | 'new') => void;
  setActiveTab: (tab: 'KATALOG' | 'FIYATLAR') => void;
  setDetailTab: (tab: 'temel' | 'modifiye' | 'fiyat' | 'recete') => void;
  setSearchQuery: (query: string) => void;
  setCategoryFilter: (categoryId: string | null) => void;
  toggleFilterTukendi: () => void;
  toggleFilterSatista: () => void;
  clearError: () => void;

  saveProduct: (productData: Partial<ProductDto>) => Promise<boolean>;
  toggleProductActive: (productId: string) => Promise<boolean>;
  toggleProduct86: (productId: string, is86: boolean, reason?: string) => Promise<boolean>;
  deleteProduct: (productId: string) => Promise<boolean>;

  createCategory: (name: string, defaultStation?: string) => Promise<boolean>;
  updateCategory: (category: CategoryDto, name: string, defaultStation: string) => Promise<boolean>;
  deleteCategory: (categoryId: string) => Promise<boolean>;

  calculateBulkPreview: (
    updateType: 'PERCENTAGE' | 'FIXED_AMOUNT',
    valueNum: number,
    categoryId?: string
  ) => void;
  clearBulkPreview: () => void;
  applyBulkPrice: (input: BulkPriceInput) => Promise<BulkPriceResult | null>;

  createPriceList: (name: string, description?: string) => Promise<boolean>;
  deletePriceList: (priceListId: string) => Promise<boolean>;

  loadProductRecipe: (productId: string) => Promise<void>;
  createRecipe: (input: RecipeInputDto) => Promise<boolean>;
  deactivateRecipe: (productId: string, recipeId: string) => Promise<boolean>;
  loadProductModifierGroupIds: (productId: string) => Promise<void>;
  setProductModifierGroupIds: (productId: string, groupIds: string[]) => Promise<boolean>;
  createModifierGroup: (
    name: string,
    minSelections: number,
    maxSelections: number,
    isRequired: boolean
  ) => Promise<boolean>;
  deleteModifierGroup: (groupId: string) => Promise<boolean>;
  deleteModifierOption: (optionId: string) => Promise<boolean>;
  addModifierOption: (
    groupId: string,
    name: string,
    priceCents: number
  ) => Promise<boolean>;
}
