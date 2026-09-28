import { Recipe, RecipeIngredient, RecipeVersion } from './types';

export interface CreateRecipeDTO {
  id?: string;
  name: string;
  sku?: string;
  category?: string;
  ingredients: RecipeIngredient[];
  yieldQuantity?: number;
  timestamp?: string;
}

export interface UpdateRecipeDTO {
  ingredients: RecipeIngredient[];
  yieldQuantity?: number;
  changeReason?: string;
  timestamp?: string;
}

export class RecipeManager {
  private recipes: Map<string, Recipe> = new Map();
  private versionsById: Map<string, RecipeVersion> = new Map();

  public static calculateTheoreticalCost(
    ingredients: RecipeIngredient[],
    yieldQuantity: number = 1
  ): number {
    if (yieldQuantity <= 0) {
      throw new Error('Yield quantity must be greater than zero.');
    }
    const totalCost = ingredients.reduce((sum, ing) => {
      return sum + ing.quantity * ing.costPerUnit;
    }, 0);
    return Math.round((totalCost / yieldQuantity) * 10000) / 10000;
  }

  public createRecipe(dto: CreateRecipeDTO): Recipe {
    const timestamp = dto.timestamp ?? new Date().toISOString();
    const recipeId = dto.id ?? `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const yieldQuantity = dto.yieldQuantity && dto.yieldQuantity > 0 ? dto.yieldQuantity : 1;

    if (this.recipes.has(recipeId)) {
      throw new Error(`Recipe with ID "${recipeId}" already exists.`);
    }

    const versionId = `rcpv_${recipeId}_v1`;
    const theoreticalCost = RecipeManager.calculateTheoreticalCost(dto.ingredients, yieldQuantity);

    const initialVersion: RecipeVersion = {
      recipe_version_id: versionId,
      recipeId,
      versionNumber: 1,
      ingredients: dto.ingredients.map((ing) => ({ ...ing })),
      yieldQuantity,
      theoreticalCostPerUnit: theoreticalCost,
      effectiveFrom: timestamp,
      effectiveTo: null,
      changeReason: 'Initial recipe creation',
    };

    const recipe: Recipe = {
      id: recipeId,
      name: dto.name,
      sku: dto.sku,
      category: dto.category,
      active_version_id: versionId,
      versions: [initialVersion],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.recipes.set(recipeId, recipe);
    this.versionsById.set(versionId, initialVersion);

    return JSON.parse(JSON.stringify(recipe));
  }

  /**
   * Malzemeler, miktarlar veya birim maliyetler değiştiğinde tarifin yeni bir versiyonunu oluşturur.
   * Bu, tarihsel bütünlüğü garanti eder: geçmiş satışlar, orijinal tarif_versiyon_id'lerine bağlı kalır.
   */
  public updateRecipe(recipeId: string, dto: UpdateRecipeDTO): RecipeVersion {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) {
      throw new Error(`Recipe with ID "${recipeId}" not found.`);
    }

    const currentVersion = this.versionsById.get(recipe.active_version_id);
    if (!currentVersion) {
      throw new Error(
        `Active version "${recipe.active_version_id}" not found for recipe "${recipeId}".`
      );
    }

    const timestamp = dto.timestamp ?? new Date().toISOString();
    const yieldQuantity =
      dto.yieldQuantity && dto.yieldQuantity > 0 ? dto.yieldQuantity : currentVersion.yieldQuantity;
    const newTheoreticalCost = RecipeManager.calculateTheoreticalCost(
      dto.ingredients,
      yieldQuantity
    );

    // Close the validity interval of the active version
    currentVersion.effectiveTo = timestamp;

    const nextVersionNumber = recipe.versions.length + 1;
    const newVersionId = `rcpv_${recipeId}_v${nextVersionNumber}`;

    const newVersion: RecipeVersion = {
      recipe_version_id: newVersionId,
      recipeId,
      versionNumber: nextVersionNumber,
      ingredients: dto.ingredients.map((ing) => ({ ...ing })),
      yieldQuantity,
      theoreticalCostPerUnit: newTheoreticalCost,
      effectiveFrom: timestamp,
      effectiveTo: null,
      changeReason: dto.changeReason ?? 'Recipe ingredients or cost modification',
    };

    recipe.versions.push(newVersion);
    recipe.active_version_id = newVersionId;
    recipe.updatedAt = timestamp;

    this.versionsById.set(newVersionId, newVersion);

    return JSON.parse(JSON.stringify(newVersion));
  }

  public getRecipe(recipeId: string): Recipe | undefined {
    const recipe = this.recipes.get(recipeId);
    return recipe ? JSON.parse(JSON.stringify(recipe)) : undefined;
  }

  /**
   * Tarihsel arama garantisi: satış zamanında kullanılan tam dondurulmuş tarif versiyonunu çözer.
   */
  public getVersion(recipeVersionId: string): RecipeVersion | undefined {
    const version = this.versionsById.get(recipeVersionId);
    return version ? JSON.parse(JSON.stringify(version)) : undefined;
  }

  public getActiveVersion(recipeId: string): RecipeVersion | undefined {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return undefined;
    return this.getVersion(recipe.active_version_id);
  }

  /**
   * Zamanda rastgele bir noktada aktif olan versiyonu çözer.
   */
  public getVersionAtDate(recipeId: string, timestamp: string | Date): RecipeVersion | undefined {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return undefined;

    const targetTime = new Date(timestamp).getTime();

    const matched = recipe.versions.find((v) => {
      const fromTime = new Date(v.effectiveFrom).getTime();
      const toTime = v.effectiveTo ? new Date(v.effectiveTo).getTime() : Infinity;
      return targetTime >= fromTime && targetTime < toTime;
    });

    return matched ? JSON.parse(JSON.stringify(matched)) : undefined;
  }

  public getAllVersions(recipeId: string): RecipeVersion[] {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return [];
    return JSON.parse(JSON.stringify(recipe.versions));
  }

  public getAllRecipes(): Recipe[] {
    return Array.from(this.recipes.values()).map((r) => JSON.parse(JSON.stringify(r)));
  }
}
