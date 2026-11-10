      <BarcodeScanner
        open={scanning}
        onClose={() => setScanning(false)}
        continuous
        onDetected={(code) => addCount(code, true)}
        countEntries={Array.from(counts.values())}
        onChangeCount={setCount}
      />
    </div>
  );
}

function AdminHistoryRow({ row, onEdit, onDelete }: { row: HistoryRow; onEdit: () => void; onDelete: () => void }) {
  const diff = row.counted_quantity - row.system_stock;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{row.product_name}</div>
        <div className="text-muted-foreground">
          {branchLabel(row.branch)} · Sys: {row.system_stock} · Contado: {row.counted_quantity}{" "}
          <span className={diff === 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-amber-600"}>
            ({diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff})
          </span>
        </div>
        <div className="text-[10px] text-blue-600 dark:text-blue-400">
          {row.collaborator_name ?? "—"} · {new Date(row.created_at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      <button type="button" onClick={onEdit} className="shrink-0 rounded p-1 hover:bg-muted">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onDelete} className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
