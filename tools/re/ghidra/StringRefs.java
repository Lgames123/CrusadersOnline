// For defined strings matching a regex: list referencing functions and decompile them (args: out, regex, maxFuncs).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.util.*;
import java.util.regex.*;

public class StringRefs extends GhidraScript {
  @Override
  public void run() throws Exception {
    String[] a = getScriptArgs();
    PrintWriter out = new PrintWriter(new FileWriter(a[0]));
    Pattern re = Pattern.compile(a[1], Pattern.CASE_INSENSITIVE);
    int max = Integer.parseInt(a[2]);
    Set<Function> funcs = new LinkedHashSet<>();
    DataIterator it = currentProgram.getListing().getDefinedData(true);
    while (it.hasNext()) {
      Data d = it.next();
      Object v = d.getValue();
      if (!(v instanceof String s) || !re.matcher(s).find()) continue;
      out.println("STRING " + d.getAddress() + " \"" + s + "\"");
      for (Reference r : getReferencesTo(d.getAddress())) {
        Function f = getFunctionContaining(r.getFromAddress());
        out.println("   ref " + r.getFromAddress() + " in " + (f == null ? "-" : f.getName() + "@" + f.getEntryPoint()));
        if (f != null) funcs.add(f);
      }
    }
    DecompInterface dec = new DecompInterface();
    dec.openProgram(currentProgram);
    int n = 0;
    for (Function f : funcs) {
      if (n++ >= max) break;
      DecompileResults r = dec.decompileFunction(f, 120, monitor);
      out.println("\n// ===== " + f.getName() + " @ " + f.getEntryPoint());
      out.println(r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// failed");
    }
    out.close();
  }
}
