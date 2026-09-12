    const sys = Number(prod.stock_a) + Number(prod.stock_b);
    setCounts((prev) => {
      const existing = prev.get(code);
      const newMap = new Map(prev);
      newMap.set(code, { barcode: code, product_name: prod.product_name, count: (existing?.count ?? 0) + 1, system_stock: sys });
      return newMap;
    });
    toast.success(`+1 · ${prod.product_name}`);
    scanRef.current?.focus();
    flashProduct(code);
  }, [products, category, online]);

  function setCount(barcode: string, val: number) {
    const prod = products.find((p) => p.barcode === barcode);
    if (!prod) return;
    const sys = Number(prod.stock_a) + Number(prod.stock_b);
    setCounts((prev) => {
      const newMap = new Map(prev);
      if (val <= 0) { newMap.delete(barcode); return newMap; }
      newMap.set(barcode, { barcode, product_name: prod.product_name, count: val, system_stock: sys });
      return newMap;
    });
  }

  function changeCategory(newCat: string) {
    if (counts.size > 0 && newCat !== category) {
      if (!confirm("¿Cambiar de categoría? Se perderá el conteo actual.")) return;
    }
    setCategory(newCat);
    setCounts(new Map());
    if (!newCat) clearCatState();
  }
