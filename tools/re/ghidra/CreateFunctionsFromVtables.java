// Creates functions Ghidra's auto-analysis missed in crusaders.exe (MSVC 6, heavy use of
// virtual calls): targets of vtable-like pointer runs in read-only data, and call targets that
// land outside any function. Repeats until nothing new is found. Read-only towards the binary
// on disk; it only adds functions to the Ghidra database.
//
// Usage: Script Manager -> add this folder (tools/re/ghidra) -> run. Re-running is harmless.
//@category CrusadersOnline

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

import java.util.LinkedHashSet;
import java.util.Set;

public class CreateFunctionsFromVtables extends GhidraScript {

    private static final int MIN_RUN = 2; // consecutive code pointers that make a vtable

    @Override
    protected void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        MemoryBlock text = mem.getBlock(".text");
        if (text == null) {
            printerr("no .text block");
            return;
        }
        int total = 0;
        for (int pass = 1; pass <= 10 && !monitor.isCancelled(); pass++) {
            Set<Address> candidates = new LinkedHashSet<>();
            for (String name : new String[] {".rdata", ".data"}) {
                MemoryBlock b = mem.getBlock(name);
                if (b != null) collectVtableTargets(mem, b, text, candidates);
            }
            collectCallTargets(text, candidates);
            int created = 0;
            for (Address a : candidates) {
                if (monitor.isCancelled()) break;
                if (getFunctionContaining(a) != null) continue;
                if (getInstructionAt(a) == null) disassemble(a);
                if (getInstructionAt(a) == null) continue;
                Function f = createFunction(a, null);
                if (f != null) created++;
            }
            total += created;
            println("pass " + pass + ": " + candidates.size() + " candidates, " + created + " functions created");
            if (created == 0) break;
        }
        println("done: " + total + " functions created");
    }

    private void collectVtableTargets(Memory mem, MemoryBlock block, MemoryBlock text, Set<Address> out) throws Exception {
        Address a = block.getStart();
        Address end = block.getEnd();
        Set<Address> run = new LinkedHashSet<>();
        while (a.compareTo(end) < 0 && !monitor.isCancelled()) {
            Address target = null;
            try {
                long v = mem.getInt(a) & 0xffffffffL;
                Address t = toAddr(v);
                // MSVC 6 aligns function entries to 16 bytes; switch-table case labels usually are
                // not, so this keeps jump tables from creating bogus functions mid-routine.
                if (text.contains(t) && (v & 0xf) == 0) target = t;
            } catch (Exception ignored) {
                // unreadable / uninitialised
            }
            if (target != null) {
                run.add(target);
            } else {
                if (run.size() >= MIN_RUN) out.addAll(run);
                run.clear();
            }
            a = a.add(4);
        }
        if (run.size() >= MIN_RUN) out.addAll(run);
    }

    private void collectCallTargets(MemoryBlock text, Set<Address> out) {
        ReferenceIterator it = currentProgram.getReferenceManager().getReferenceIterator(text.getStart());
        while (it.hasNext() && !monitor.isCancelled()) {
            Reference r = it.next();
            if (!text.contains(r.getFromAddress())) break;
            if (!r.getReferenceType().isCall()) continue;
            Address to = r.getToAddress();
            if (text.contains(to) && getFunctionContaining(to) == null) out.add(to);
        }
    }
}
