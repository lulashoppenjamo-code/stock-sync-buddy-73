system_stock: r.system_stock,
        my_count: r.physical_count,
        difference: r.difference,
      }));
      setSummaryData(summary);
      qc.invalidateQueries({ queryKey: ["audits"] });
      qc.invalidateQueries({ queryKey: ["audits-today-category"] });
      setCounts(new Map());
      toast.success(`${rows.length} productos guardados`);
    } catch (err) { toast.error((err as Error).message); }
    finally { setSavingCategory(false); }
  }

  async function deleteAudit(id: string) {
    admin.requireAdmin(async () => {
      const { error } = await supabase.from("audits").delete().eq("id", id);
      if (error) return toast.error(error.message);
      toast.success("Registro eliminado");
      refetchHistory();
    });
  }

  const totalStock = current ? Number(current.stock_a) + Number(current.stock_b) : 0;
  const sumToday = (todayForProduct ?? []).reduce((s, r) => s + Number(r.physical_count), 0);
  const sumMina = (todayForProduct ?? []).filter((r) => r.branch === "A").reduce((s, r) => s + Number(r.physical_count), 0);
  const sumMorelos = (todayForProduct ?? []).filter((r) => r.branch === "B").reduce((s, r) => s + Number(r.physical_count), 0);
  const previewSum = current && physical !== "" ? sumToday + Number(physical) : sumToday;
  const previewMina = branch === "A" && physical !== "" ? sumMina + Number(physical) : sumMina;
  const previewMorelos = branch === "B" && physical !== "" ? sumMorelos + Number(physical) : sumMorelos;
  const previewDiff = current ? previewSum - totalStock : 0;

  const todayCatByBarcode = new Map<string, { mina: number; morelos: number }>();
  for (const r of todayCategory) {
    const entry = todayCatByBarcode.get(r.barcode) ?? { mina: 0, morelos: 0 };
    if (r.branch === "A") entry.mina += Number(r.physical_count);
    else if (r.branch === "B") entry.morelos += Number(r.physical_count);
    todayCatByBarcode.set(r.barcode, entry);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Auditoría</h1>

      {/* Mode tabs */}
      <div className="inline-flex overflow-hidden rounded-md border">
        <button type="button" onClick={() => setMode("single")}
          className={`px-4 py-2 text-sm font-medium ${mode === "single" ? "bg-primary text-primary-foreground" : "bg-background"}`}>
          Producto individual
        </button>
        <button type="button" onClick={() => setMode("category")}
          className={`px-4 py-2 text-sm font-medium ${mode === "category" ? "bg-primary text-primary-foreground" : "bg-background"}`}>
          Por categoría
        </button>
      </div>

      {/* ── SINGLE PRODUCT MODE ── */}
      {mode === "single" && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <form onSubmit={handleScan}>
              <label className="text-xs font-medium text-muted-foreground">Escanear código (Enter)</label>
              <div className="relative mt-1 flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input ref={scanRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder="Pistola, cámara o tipear…" className="pl-9 font-mono text-base" inputMode="numeric" />
                </div>
