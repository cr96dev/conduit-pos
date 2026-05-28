// AIDL para el servicio InnerPrinter de Sunmi.
//
// Copia exacta del AIDL publicado por Sunmi en SunmiPrinterDemo (GitHub).
// El orden de los metodos define el TX_CODE Binder — no modificar.
//
// Bind:
//   Intent intent = new Intent();
//   intent.setPackage("woyou.aidlservice.jiuiv5");
//   intent.setAction("woyou.aidlservice.jiuiv5.IWoyouService");
//   bindService(intent, conn, BIND_AUTO_CREATE);

package woyou.aidlservice.jiuiv5;

import woyou.aidlservice.jiuiv5.ICallback;

interface IWoyouService {
    void printerInit(in ICallback callback);
    void printerSelfChecking(in ICallback callback);
    String getPrinterSerialNo();
    String getPrinterVersion();
    String getPrinterModal();
    String getPrintedLength(in ICallback callback);
    void lineWrap(int n, in ICallback callback);
    void sendRAWData(in byte[] data, in ICallback callback);
    void setAlignment(int alignment, in ICallback callback);
    void setFontName(String typeface, in ICallback callback);
    void setFontSize(float fontsize, in ICallback callback);
    void printText(String text, in ICallback callback);
    void printTextWithFont(String text, String typeface, float fontsize, in ICallback callback);
    void printColumnsText(in String[] colsTextArr, in int[] colsWidthArr, in int[] colsAlign, in ICallback callback);
    void printBitmap(in android.graphics.Bitmap bitmap, in ICallback callback);
    void printBarCode(String data, int symbology, int height, int width, int textposition, in ICallback callback);
    void printQRCode(String data, int modulesize, int errorlevel, in ICallback callback);
    void printOriginalText(String text, in ICallback callback);
    void commitPrinterBuffer();
    void enterPrinterBuffer(boolean clean);
    void exitPrinterBuffer(boolean commit);
    void printerBuffer(in ICallback callback);
    void cutPaper(in ICallback callback);
    int getPrinterStatus();
}
