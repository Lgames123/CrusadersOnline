// Disassembles [start, end) and prints the instructions (args: out, start, end).
import ghidra.app.script.GhidraScript;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;

public class Disasm extends GhidraScript {
  @Override
  public void run() throws Exception {
    String[] a = getScriptArgs();
    PrintWriter out = new PrintWriter(new FileWriter(a[0]));
    Address s = toAddr(a[1]), e = toAddr(a[2]);
    new DisassembleCommand(new AddressSet(s, e), null, true).applyTo(currentProgram, monitor);
    for (Instruction ins = getInstructionAt(s); ins != null && ins.getAddress().compareTo(e) < 0; ins = ins.getNext())
      out.println(ins.getAddress() + "  " + ins);
    out.close();
  }
}
