import java.nio.file.*;
import java.net.*;
import java.io.*;
import java.util.*;
/** Uses the pinned Android SDK converter; does not rewrite or hand-trace SVG paths. */
class ConvertSvg {
 public static void main(String[] args) throws Exception {
  Path cache=Path.of(System.getProperty("user.home"),".gradle/caches/modules-2/files-2.1");
  List<URL> urls=new ArrayList<>();
  try(var files=Files.walk(cache)) { for(Path p:files.filter(p->p.toString().endsWith(".jar")&&!p.toString().endsWith("-sources.jar")).toList()) urls.add(p.toUri().toURL()); }
  try(var loader=new URLClassLoader(urls.toArray(URL[]::new),ClassLoader.getPlatformClassLoader())) {
   var method=Class.forName("com.android.ide.common.vectordrawable.Svg2Vector",true,loader).getMethod("parseSvgToXml",Path.class,OutputStream.class);
   try(var files=Files.list(Path.of(args[0]))) {
    for(Path file:files.filter(p->p.toString().endsWith(".svg")).sorted().toList()) {
     Path output=Path.of(args[1],"ac_"+file.getFileName().toString().replace(".svg",".xml").replace('-','_'));
     try(var stream=Files.newOutputStream(output)) {
      String diagnostics=(String)method.invoke(null,file,stream);
      if(!diagnostics.isBlank()) throw new IOException(file+": "+diagnostics);
     }
     // Android vector resources have no CSS currentColor; Compose supplies the actual tint.
     Files.writeString(output,Files.readString(output).replace("currentColor","#000000"));
     if(Files.size(output)==0) throw new IOException("Empty vector "+output);
     System.out.println(file.getFileName()+" -> "+output.getFileName());
    }
   }
  }
 }
}
