python3 -c "
h=open('/tmp/gen/head23.html').read(); a=open('/tmp/gen/app23.js').read(); at=open('/tmp/gen/atlases3.json').read(); rl=open('/tmp/gen/real.json').read(); cat=open('/tmp/gen/catalogue2.json').read()
open('/mnt/user-data/outputs/rosse-v21.html','w').write(h+'<script>window.__ATLASES='+at+';window.__REAL='+rl+';window.__CAT='+cat+';</script>\n<script>\n'+a+'\n</script>\n</body>\n</html>\n')"
