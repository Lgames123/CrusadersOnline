// Lists instructions whose operands hold the given scalar values (args: out file, hex values...).
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;
import java.util.*;

public class FindScalar extends GhidraScript {
  @Override
  public void run() throws Exception {
    String[] a = getScriptArgs();
    PrintWriter out = new PrintWriter(new FileWriter(a[0]));
    Set<Long> want = new HashSet<>();
    for (int i = 1; i < a.length; i++) want.add(Long.parseLong(a[i].replace("0x", ""), 16));
    InstructionIterator it = currentProgram.getListing().getInstructions(true);
    while (it.hasNext() && !monitor.isCancelled()) {
      Instruction ins = it.next();
      for (int op = 0; op < ins.getNumOperands(); op++) {
        for (Object o : ins.getOpObjects(op)) {
          if (o instanceof Scalar s && want.contains(s.getUnsignedValue() & 0xffffffffL)) {
            Function f = getFunctionContaining(ins.getAddress());
            out.println(ins.getAddress() + "  " + ins + "  in " + (f == null ? "-" : f.getName() + "@" + f.getEntryPoint()));
          }
        }
      }
    }
    out.close();
  }
}
