"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  Coffee,
  GlassWater,
  Citrus,
  Milk,
  Snowflake,
  EggFried,
  Sandwich,
  Salad,
  Utensils,
  Croissant,
  Cake,
  IceCream,
  type LucideIcon,
} from "lucide-react";
import { ProductCard } from "@/features/catalog/product-card";
import { CATALOG_GRID_CLASS } from "@/features/catalog/catalog-grid";
import { useT } from "@/components/providers/locale-provider";
import { useLocalizedCategory } from "@/hooks/useLocalizedContent";
import { getCategoryHeroImage } from "@/lib/menu/placeholders";
import type { CatalogSectionGroup } from "@/lib/menu/category-tree";
import type { Category, Product } from "@/types";

const iconMap: Record<string, LucideIcon> = {
  coffee: Coffee,
  "glass-water": GlassWater,
  citrus: Citrus,
  milk: Milk,
  snowflake: Snowflake,
  "egg-fried": EggFried,
  sandwich: Sandwich,
  salad: Salad,
  utensils: Utensils,
  croissant: Croissant,
  cake: Cake,
  "ice-cream": IceCream,
};

interface CategoryProductSectionProps {
  category: Category;
  groups: CatalogSectionGroup[];
  count: number;
  /** Number of products rendered before this section, so card `index` (image priority) is page-wide. */
  indexOffset?: number;
  onProductClick: (product: Product) => void;
}

/**
 * One root category in the single-page catalog: heading + products, with subcategory
 * products under small sub-headings. `data-category-id` is read by the scroll-spy.
 */
export function CategoryProductSection({
  category,
  groups,
  count,
  indexOffset = 0,
  onProductClick,
}: CategoryProductSectionProps) {
  const t = useT();
  const localized = useLocalizedCategory(category);

  if (count === 0) return null;

  const Icon = iconMap[category.icon] ?? Coffee;
  // The category image from the admin: a small, quiet strip above the heading. No image → nothing.
  const stripImage = getCategoryHeroImage(category.image, category.id);

  return (
    <section
      id={`category-${category.id}`}
      data-category-id={category.id}
      aria-labelledby={`category-title-${category.id}`}
      className="pt-6 md:pt-8"
    >
      {stripImage && (
        <div className="relative mb-3 h-16 overflow-hidden rounded-2xl md:h-20" data-category-strip={category.id}>
          <Image
            src={stripImage}
            alt=""
            aria-hidden
            fill
            loading="lazy"
            unoptimized={stripImage.includes("firebasestorage")}
            className="object-cover"
            sizes="(max-width: 1280px) 100vw, 1200px"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-cream/50 to-transparent" />
        </div>
      )}
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-turquoise/10 text-turquoise">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 id={`category-title-${category.id}`} className="heading-section" dir={localized.dir}>
            {localized.name}
          </h2>
          <p className="mt-0.5 text-sm text-coffee/55">
            {count} {t("catalog.productsCount")}
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {groups.map((group, groupIndex) => {
          const groupOffset =
            indexOffset + groups.slice(0, groupIndex).reduce((sum, g) => sum + g.products.length, 0);
          return (
            <div key={group.subcategory?.id ?? "_root"}>
              {group.subcategory && <SubcategoryHeading category={group.subcategory} />}
              <div className={CATALOG_GRID_CLASS}>
                {group.products.map((product, index) => (
                  <motion.div
                    key={product.id}
                    className="h-full min-w-0"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(index, 6) * 0.03, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {/* Page-wide index: only the first few cards on the page get image priority. */}
                    <ProductCard
                      product={product}
                      index={groupOffset + index}
                      onClick={() => onProductClick(product)}
                    />
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SubcategoryHeading({ category }: { category: Category }) {
  const localized = useLocalizedCategory(category);
  return (
    <h3 className="mb-2 text-sm font-semibold text-coffee/75" dir={localized.dir}>
      {localized.name}
    </h3>
  );
}

export { CATALOG_GRID_CLASS } from "@/features/catalog/catalog-grid";
