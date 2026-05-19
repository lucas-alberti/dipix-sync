"""
Automatización: Exporta depósitos de Dipix, procesa con pandas y sincroniza con Supabase.

Uso normal (headless, para CI/cron):
    python depositos_sync.py --headless

Modo visual (para depuración local):
    python depositos_sync.py

Modo diagnóstico con screenshots:
    python depositos_sync.py --debug

Credenciales vía variables de entorno:
    DIPIX_USER, DIPIX_PASS, SUPABASE_URL, SUPABASE_KEY
"""

import argparse
import asyncio
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import pandas as pd
from playwright.async_api import async_playwright

# ── Configuración — todas las credenciales vienen de variables de entorno ────
DIPIX_URL    = "http://52.23.89.2:8080/hoteles/servlet/hlogon"
DIPIX_USER   = os.environ.get("DIPIX_USER", "")
DIPIX_PASS   = os.environ.get("DIPIX_PASS", "")

SYNC_ENDPOINT = os.environ.get(
    "SYNC_ENDPOINT",
    "https://project--339234fe-cd36-4683-be64-6295a9023bbb.lovable.app/api/public/sync-balances",
)
CRON_SECRET = os.environ.get("CRON_SECRET", "")

DOWNLOAD_DIR = Path(tempfile.mkdtemp())
SCREENSHOTS_DIR = Path("screenshots_debug")


# ── Paso 1-4: Descarga del Excel via Playwright ──────────────────────────────
async def descargar_excel(headless: bool = True, debug: bool = False, browser: str = "chromium") -> Path:
    if debug:
        SCREENSHOTS_DIR.mkdir(exist_ok=True)

    async def shot(page, name):
        if debug:
            p = SCREENSHOTS_DIR / f"{name}.png"
            await page.screenshot(path=str(p), full_page=True)
            print(f"   [debug] screenshot: {p}")

    async with async_playwright() as pw:
        launcher = pw.firefox if browser == "firefox" else pw.chromium
        browser = await launcher.launch(
            headless=headless,
            slow_mo=600 if not headless else 0,
        )
        context = await browser.new_context(accept_downloads=True)
        page = await context.new_page()

        # ── Login ──────────────────────────────────────────────────────────
        print("→ Navegando al login de Dipix...")
        await page.goto(DIPIX_URL, wait_until="networkidle")
        await shot(page, "01_login")

        # Detectar campos de usuario/contraseña de forma flexible
        user_field = page.locator(
            'input[name="usuario"], input[name="user"], input[name="username"], '
            'input[type="text"]:visible'
        ).first
        pass_field = page.locator(
            'input[name="password"], input[name="pass"], input[name="contrasena"], '
            'input[type="password"]:visible'
        ).first

        await user_field.fill(DIPIX_USER)
        await pass_field.fill(DIPIX_PASS)
        await shot(page, "02_credenciales")

        submit = page.locator(
            'input[type="submit"], button[type="submit"], button:has-text("Ingresar"), '
            'button:has-text("Entrar"), button:has-text("Login")'
        ).first
        await submit.click()
        await page.wait_for_load_state("networkidle")
        await shot(page, "03_post_login")
        print(f"   URL post-login: {page.url}")

        # ── Menú Validaciones ──────────────────────────────────────────────
        print("→ Navegando a Validaciones > Confirmación de Depósitos...")
        await page.get_by_text("Validaciones", exact=False).first.click()
        await page.wait_for_load_state("networkidle")
        await shot(page, "04_menu_validaciones")

        await page.get_by_text("Confirmación de Depósitos", exact=False).first.click()
        await page.wait_for_load_state("networkidle")
        await shot(page, "05_confirmacion_depositos")
        print(f"   URL sección: {page.url}")

        # ── Desplegable Mostrar ────────────────────────────────────────────
        print("→ Seleccionando 'Todos los depósitos'...")
        # Filtrar el select que contiene las opciones de filtro de depósitos
        mostrar_select = page.locator("select").filter(has_text="sin confirmar")
        # Listar opciones para diagnóstico
        opts = await mostrar_select.evaluate(
            "el => Array.from(el.options).map(o => ({v: o.value, t: o.text.trim()}))"
        )
        print(f"   Opciones del desplegable: {opts}")
        # Seleccionar la opción que contenga "todos" (case-insensitive)
        todos_opt = next(
            (o for o in opts if "todos" in o["t"].lower()), None
        )
        if todos_opt:
            await mostrar_select.select_option(value=todos_opt["v"])
        else:
            # fallback: seleccionar último elemento
            await mostrar_select.select_option(index=len(opts) - 1)
        await page.wait_for_load_state("networkidle")
        await shot(page, "06_todos_depositos")

        # ── Descargar Excel ────────────────────────────────────────────────
        print("→ Buscando botón exportar...")
        excel_btn = page.locator(
            "[title='exportar'], [title='Exportar'], [title*='xport'], "
            "[alt='exportar'], [alt='Exportar']"
        ).first
        await shot(page, "07_antes_excel")

        print("→ Descargando Excel (puede tardar con muchos registros)...")
        async with page.expect_download(timeout=180_000) as dl_info:
            await excel_btn.click(timeout=180_000)
        download = await dl_info.value

        dest = DOWNLOAD_DIR / (download.suggested_filename or "depositos.xlsx")
        await download.save_as(dest)
        print(f"→ Archivo descargado: {dest}")

        await browser.close()
        return dest


# ── Paso 5-6: Procesamiento con pandas ───────────────────────────────────────
def _col(df, *keywords) -> str | None:
    """Encuentra la primera columna cuyo nombre contiene alguna de las keywords."""
    cols = df.columns.str.lower()
    for col_lower, col_orig in zip(cols, df.columns):
        if any(k in col_lower for k in keywords):
            return col_orig
    return None


def procesar_excel(path: Path) -> pd.DataFrame:
    print(f"→ Leyendo {path.name}...")
    suffix = path.suffix.lower()
    if suffix == ".xls":
        engine = "xlrd"
    elif suffix in (".xlsx", ".xlsm"):
        engine = "openpyxl"
    else:
        # intentar detectar por contenido
        with open(path, "rb") as f:
            magic = f.read(4)
        engine = "xlrd" if magic[:2] == b"\xd0\xcf" else "openpyxl"
    print(f"   Engine: {engine}")
    df = pd.read_excel(path, engine=engine)
    df.columns = df.columns.str.strip()
    print(f"   Columnas encontradas: {list(df.columns)}")

    # Mapeo exacto de columnas conocidas, con fallback por keywords
    EXACT = {
        "estadia":  "Estadía",
        "dep":      "Monto del Depósito",
        "estmonto": "Monto de la Estadía",
        "hotel":    "Hotel",
    }
    cols_set = set(df.columns)

    COL_ESTADIA       = EXACT["estadia"]   if EXACT["estadia"]   in cols_set else _col(df, "stad", "estadia", "reserva")
    COL_MONTO_DEP     = EXACT["dep"]       if EXACT["dep"]       in cols_set else _col(df, "monto dep", "importe dep")
    COL_MONTO_ESTADIA = EXACT["estmonto"]  if EXACT["estmonto"]  in cols_set else _col(df, "monto de la est", "monto est")
    COL_HOTEL         = EXACT["hotel"]     if EXACT["hotel"]     in cols_set else _col(df, "hotel", "propiedad")
    # Este export no tiene fecha de ingreso — se omite el filtro por fecha
    COL_INGRESO       = None

    missing = [n for n, c in [
        ("Estadía/Reserva", COL_ESTADIA),
        ("Monto Depósito",  COL_MONTO_DEP),
        ("Monto Estadía",   COL_MONTO_ESTADIA),
    ] if c is None]
    if missing:
        raise ValueError(
            f"No se encontraron las columnas requeridas: {missing}\n"
            f"Columnas disponibles: {list(df.columns)}"
        )

    print(f"   Estadía:        {COL_ESTADIA}")
    print(f"   Monto depósito: {COL_MONTO_DEP}")
    print(f"   Monto estadía:  {COL_MONTO_ESTADIA}")
    print(f"   Hotel:          {COL_HOTEL}")
    print(f"   Fecha ingreso:  {COL_INGRESO}")

    df[COL_MONTO_DEP]     = pd.to_numeric(df[COL_MONTO_DEP], errors="coerce").fillna(0)
    df[COL_MONTO_ESTADIA] = pd.to_numeric(df[COL_MONTO_ESTADIA], errors="coerce").fillna(0)

    agg: dict = {COL_MONTO_DEP: "sum", COL_MONTO_ESTADIA: "first"}
    if COL_HOTEL:
        agg[COL_HOTEL] = "first"
    if COL_INGRESO:
        agg[COL_INGRESO] = "first"

    resumen = df.groupby(COL_ESTADIA, as_index=False).agg(agg)
    rename_map = {
        COL_ESTADIA:       "reserva_id",
        COL_MONTO_DEP:     "pagado",
        COL_MONTO_ESTADIA: "total",
    }
    if COL_HOTEL:
        rename_map[COL_HOTEL] = "hotel"
    if COL_INGRESO:
        rename_map[COL_INGRESO] = "fecha_ingreso"
    resumen = resumen.rename(columns=rename_map)

    resumen["saldo"] = resumen["total"] - resumen["pagado"]
    if "hotel" not in resumen.columns:
        resumen["hotel"] = None

    # Filtro por ventana de 7 días
    if "fecha_ingreso" in resumen.columns:
        resumen["fecha_ingreso"] = pd.to_datetime(resumen["fecha_ingreso"], errors="coerce")
        hoy    = pd.Timestamp(datetime.now().date())
        limite = hoy + timedelta(days=7)
        antes  = len(resumen)
        resumen = resumen[resumen["fecha_ingreso"].between(hoy, limite)]
        print(f"→ Filtro fecha ingreso [{hoy.date()} … {limite.date()}]: "
              f"{antes} filas → {len(resumen)}")
    else:
        print("   ADVERTENCIA: sin columna de fecha de ingreso; se procesan todas las filas.")

    resumen["updated_at"] = datetime.utcnow().isoformat()
    return resumen[["reserva_id", "hotel", "total", "pagado", "saldo", "updated_at"]]


# ── Paso 7: POST al endpoint de Lovable ──────────────────────────────────────
def upsert_supabase(df: pd.DataFrame) -> None:
    print("→ Preparando registros...")
    records = df.to_dict(orient="records")
    for r in records:
        for k, v in list(r.items()):
            try:
                if pd.isna(v):
                    r[k] = None
                    continue
            except (TypeError, ValueError):
                pass
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
            elif hasattr(v, "item"):
                r[k] = v.item()

    headers = {
        "Authorization": f"Bearer {CRON_SECRET}",
        "Content-Type":  "application/json",
    }

    print(f"→ Enviando {len(records)} registros a {SYNC_ENDPOINT}...")
    with httpx.Client(timeout=60) as client:
        resp = client.post(SYNC_ENDPOINT, headers=headers, json=records)

    print(f"→ HTTP status: {resp.status_code}")
    print(f"→ Response: {resp.text[:500]}")

    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Error {resp.status_code}: {resp.text[:500]}")

    print(f"✓ Sync completado: {len(records)} registros enviados")


# ── Main ──────────────────────────────────────────────────────────────────────
async def main(headless: bool, debug: bool, browser: str) -> None:
    if not DIPIX_USER or not DIPIX_PASS:
        raise ValueError("Faltan credenciales: definí DIPIX_USER y DIPIX_PASS como variables de entorno.")
    if not CRON_SECRET:
        raise ValueError("Falta CRON_SECRET como variable de entorno.")

    excel_path = await descargar_excel(headless=headless, debug=debug, browser=browser)
    df         = procesar_excel(excel_path)

    print(f"\n→ {len(df)} registros a sincronizar")
    upsert_supabase(df)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", action="store_true",
                        help="Sin ventana de browser (CI/producción)")
    parser.add_argument("--debug", action="store_true",
                        help="Guardar screenshots en screenshots_debug/")
    parser.add_argument("--browser", default="chromium", choices=["chromium", "firefox"],
                        help="Browser a usar (default: chromium)")
    args = parser.parse_args()

    asyncio.run(main(headless=args.headless, debug=args.debug, browser=args.browser))
