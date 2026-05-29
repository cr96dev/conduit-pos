package woyou.aidlservice.jiuiv5;

import android.os.Parcel;
import android.os.Parcelable;

/**
 * Minimal Parcelable stub para TransBean. No usado a runtime — solo necesario
 * para que el AIDL compile (commitPrint lo referencia). El TX_CODE de commitPrint
 * queda en su posicion oficial y los TX_CODE posteriores (commitPrinterBuffer,
 * enterPrinterBuffer, exitPrinterBuffer) tambien.
 */
public class TransBean implements Parcelable {
    public TransBean() {}

    protected TransBean(Parcel in) {}

    @Override
    public int describeContents() { return 0; }

    @Override
    public void writeToParcel(Parcel dest, int flags) {}

    public static final Creator<TransBean> CREATOR = new Creator<TransBean>() {
        @Override
        public TransBean createFromParcel(Parcel in) { return new TransBean(in); }
        @Override
        public TransBean[] newArray(int size) { return new TransBean[size]; }
    };
}
