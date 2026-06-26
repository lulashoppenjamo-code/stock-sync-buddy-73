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
