// Like DecompileAt, but creates a function at each address first when none contains it (in memory only).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;

public class DecompileCreate extends GhidraScript {
  @Override
  public void run() throws Exception {
    String[] a = getScriptArgs();
    PrintWriter out = new PrintWriter(new FileWriter(a[0]));
    DecompInterface d = new DecompInterface();
    d.openProgram(currentProgram);
    for (int i = 1; i < a.length; i++) {
      Address addr = toAddr(a[i]);
      Function f = getFunctionAt(addr);
      if (f == null) {
        new DisassembleCommand(addr, null, true).applyTo(currentProgram, monitor);
        new CreateFunctionCmd(addr).applyTo(currentProgram, monitor);
        f = getFunctionAt(addr);
      }
      out.println("// ===== " + a[i] + " -> " + (f == null ? "could not create" : f.getName()));
      if (f == null) continue;
      DecompileResults r = d.decompileFunction(f, 180, monitor);
      out.println(r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// failed: " + r.getErrorMessage());
    }
    out.close();
  }
}
