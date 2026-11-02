import "@/styles/product.css";

// Product screens load the product stylesheets; public routes render without them.
export default function ProductStylesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
