// AIDL para el servicio InnerPrinter de Sunmi (D3 Mini, V1s, V2, P1, P2, etc.)
// Copia exacta del AIDL oficial publicado por Sunmi en SunmiPrinterDemo.
//
// NO MODIFICAR EL ORDEN DE LOS METODOS — el TX_CODE de Binder se asigna por
// posicion. Cambiar el orden rompe la compatibilidad binaria con el servicio
// remoto (que vive en el firmware Sunmi).

package woyou.aidlservice.jiuiv5;

interface ICallback {
    void onRunResult(boolean isSuccess);
    void onReturnString(String result);
    void onRaiseException(int code, String msg);
    void onPrintResult(int code, String msg);
}
