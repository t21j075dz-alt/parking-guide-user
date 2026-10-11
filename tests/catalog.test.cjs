const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
test('福岡県100店舗を4地域・47市町に配置し、全件に接近案内用の固定座標を持つ',()=>{
  const c=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../facilities.js'),'utf8'),c);
  const {metadata,facilities}=JSON.parse(vm.runInContext('JSON.stringify({metadata:CATALOG_METADATA,facilities:FACILITY_CATALOG})',c));
  const fukuoka=facilities.filter(f=>f.prefecture==='福岡県');
  assert.equal(facilities.length,211);
  assert.equal(fukuoka.length,100);
  assert.equal(new Set(facilities.map(f=>f.id)).size,211);
  assert.equal(new Set(fukuoka.map(f=>f.municipality)).size,47);
  for(const region of ['福岡地域','北九州地域','筑豊地域','筑後地域'])assert.equal(fukuoka.filter(f=>f.region===region).length,25);
  for(const f of fukuoka){
    assert.ok(Number.isFinite(f.latitude)&&f.latitude>32.8&&f.latitude<34.1,f.id);
    assert.ok(Number.isFinite(f.longitude)&&f.longitude>130&&f.longitude<131.3,f.id);
    assert.equal(f.locationVerified,true,f.id);
    assert.equal(f.layoutId,f.id,f.id);
    assert.ok(f.address.startsWith('福岡県'),f.id);
    if(Number(f.id.slice(7))>=121){assert.match(f.locationSourceUrl,/^https:\/\//);assert.match(f.coordinateSourceUrl,/^https:\/\//);}
  }
  assert.equal(new Set(fukuoka.map(f=>`${f.name}:${f.address}`)).size,100);
  assert.equal(metadata.fixedCoordinateCount,facilities.filter(f=>Number.isFinite(f.latitude)&&Number.isFinite(f.longitude)).length);
  assert.equal(fukuoka.find(f=>f.id==='target_191').name,'コメリパワー 大牟田店');
  assert.equal(fukuoka.some(f=>f.name==='スーパーセンタートライアル うきは店'),false);
});
