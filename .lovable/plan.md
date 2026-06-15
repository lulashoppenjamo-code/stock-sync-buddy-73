
# Plan: App de Inventario (Móvil + PC)

## Stack
- TanStack Start + React + Tailwind (ya configurado).
- Lovable Cloud (Supabase) para DB, Storage de fotos, y Realtime.
- PWA con `vite-plugin-pwa` (instalable + escrituras encoladas offline).

## Modelo de datos (Supabase)

```
collaborators        id, name, pin_hash, active, created_at
products             barcode (PK), product_name, uom, stock_a, stock_b, updated_at
audits               id, branch (A|B), barcode, product_name,
                     system_stock, physical_count, difference,
                     collaborator_id, created_at
transfers            id, barcode, product_name, quantity,
                     origin (A|B), destination (A|B),
                     sender_name, receiver_name, photo_url,
                     collaborator_id, created_at
csv_imports          id, filename, new_count, updated_count,
                     skipped_count, collaborator_id, created_at
```

- RLS abierta a `anon` (uso interno, identificación por PIN del lado app). El PIN se hashea (bcrypt vía función edge o pgcrypto) y solo se valida server-side mediante una RPC `verify_pin(name, pin)` que devuelve `collaborator_id`.
- Storage bucket `transfer-photos` (público de lectura, escritura por anon).
- Realtime habilitado en `products`, `audits`, `transfers`.

## Pantallas

1. **Inicio / Selector de colaborador**
   - Lista de colaboradores + PIN de 4 dígitos.
   - Guarda `collaborator_id` en localStorage. Botón "Salir".
   - Sección admin (PIN maestro) para crear/editar colaboradores.

2. **Productos**
   - Tabla con búsqueda por nombre/barcode, stock A y B.
   - Botón "Importar CSV" → parsea con `papaparse` columnas `ProductName`, `Barcode`, `UoM`.
   - **Preview de importación**: muestra cuántos son nuevos, cuántos existentes con cambios detectados (name/uom). Checkboxes "Actualizar nombre" y "Actualizar UoM". Stocks NUNCA se tocan. Confirma → upsert.
   - Registro en `csv_imports`.

3. **Auditoría**
   - Selector sucursal A/B (sticky).
   - Input "Escanear código" con `autoFocus` + `onKeyDown=Enter` (compatible pistola). Busca producto, muestra nombre + stock sistema.
   - Input numérico "Conteo físico" → al Enter/Guardar: calcula diferencia, inserta en `audits`, vuelve a enfocar el input de escaneo.
   - Tabla historial (filtros por sucursal/fecha) con diferencias en color (rojo negativa, verde positiva).

4. **Traspasos**
   - Form: Barcode (con búsqueda), Cantidad, Origen, Destino (distintos, validación), Nombre Envía, Nombre Recibe, Foto (obligatoria, `<input capture="environment">` para cámara móvil + opción galería).
   - Validación: cantidad > 0 y ≤ stock origen.
   - Al confirmar: sube foto a Storage → insert en `transfers` → UPDATE stock origen/destino en una RPC transaccional `apply_transfer(...)`.
   - Historial con thumbnail de foto.

## CSV inteligente
- Parse client-side, lookup masivo `products.select('barcode, product_name, uom').in('barcode', ...)`.
- Diff: nuevos vs existentes-con-cambios vs idénticos.
- UI muestra resumen + tabla previa antes de aplicar.

## Tiempo real + Offline (PWA)
- `supabase.channel()` suscrito a cambios de las 3 tablas → invalida React Query keys.
- `vite-plugin-pwa` con `registerType: autoUpdate`, `NetworkFirst` para navegaciones, `CacheFirst` para assets. Registro guardado (no en preview Lovable).
- **Cola offline**: tabla local IndexedDB (`idb-keyval`) que guarda mutaciones pendientes (auditoría, traspaso, importación). Al recuperar red, un `useEffect` global drena la cola en orden FIFO. Las fotos de traspaso pendientes se guardan como Blob en IndexedDB hasta poder subirlas.
- Banner "Sin conexión - X cambios pendientes" visible cuando aplica.

## Navegación
- `/` Selector de colaborador
- `/app` layout con tabs/bottom-nav: Productos · Auditoría · Traspasos · Historial
- `/admin` gestión de colaboradores

## Detalles técnicos
- React Query para cache + invalidación por Realtime.
- Zod para validar formularios y filas CSV.
- Tailwind responsive: bottom-nav en móvil, sidebar en desktop.
- Componentes shadcn ya disponibles (Table, Dialog, Input, Button, Tabs, Toast).
- Server functions (`createServerFn`) para: `verifyPin`, `bulkUpsertProducts`, `applyTransfer` (atómico con RPC SQL).

## Entregables por fases
1. Cloud + esquema + RLS + storage + RPCs.
2. Login por PIN + admin de colaboradores.
3. Productos + importación CSV con diff.
4. Auditoría con escáner.
5. Traspasos con foto + RPC de stock.
6. Realtime + PWA + cola offline.

¿Avanzo con esta estructura?
