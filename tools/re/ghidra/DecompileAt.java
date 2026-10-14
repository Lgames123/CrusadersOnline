// Decompiles the functions containing the given addresses (args: out file, addresses...).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;

public class DecompileAt extends GhidraScript {
  @Override
  public void run() throws Exception {
    String[] a = getScriptArgs();
    PrintWriter out = new PrintWriter(new FileWriter(a[0]));
    DecompInterface d = new DecompInterface();
    d.openProgram(currentProgram);
    for (int i = 1; i < a.length; i++) {
      Address addr = toAddr(a[i]);
      Function f = getFunctionContaining(addr);
      out.println("// ===== " + a[i] + " -> " + (f == null ? "no function" : f.getName() + " @ " + f.getEntryPoint()));
      if (f == null) continue;
      DecompileResults r = d.decompileFunction(f, 120, monitor);
      out.println(r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// failed: " + r.getErrorMessage());
    }
    out.close();
  }
}
