// References to each address, with a few instructions before each reference (args: out, addresses...).
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.address.*;
import java.io.*;

public class Xrefs extends GhidraScript {
  @Override
  public void run() throws Exception {
    String[] a = getScriptArgs();
    PrintWriter out = new PrintWriter(new FileWriter(a[0]));
    for (int i = 1; i < a.length; i++) {
      Address t = toAddr(a[i]);
      out.println("== refs to " + t);
      for (Reference r : getReferencesTo(t)) {
        Address from = r.getFromAddress();
        Function f = getFunctionContaining(from);
        out.println("  " + from + " " + r.getReferenceType() + " in " + (f == null ? "-" : f.getName() + "@" + f.getEntryPoint()));
        Instruction ins = getInstructionAt(from);
        for (int k = 0; k < 12 && ins != null; k++) ins = ins.getPrevious();
        for (int k = 0; k < 14 && ins != null; k++, ins = ins.getNext()) out.println("      " + ins.getAddress() + "  " + ins);
      }
    }
    out.close();
  }
}
