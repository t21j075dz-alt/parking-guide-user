const {test}=require('node:test');
const assert=require('node:assert/strict');
const {operating,shared}=require('../facility-operations.js');
test('JSTの営業時間、開始・終了境界、休業上書き、未登録を区別する',()=>{
 const op={weeklyHours:{'1':[['09:00','21:00']]},timeZone:'Asia/Tokyo'};
 assert.equal(operating(op,new Date('2026-10-26T00:00:00Z')).closed,false);
 assert.equal(operating(op,new Date('2026-10-26T12:00:00Z')).closed,true);
 assert.equal(operating({...op,closed:true},new Date('2026-10-26T00:00:00Z')).closed,true);
 assert.equal(operating({}).unknown,true);
});
test('翌日早朝は前日の夜間営業、定休日、24時間営業を正しく扱う',()=>{
 const op={weeklyHours:{'1':[['22:00','03:00']],'2':[]}};
 assert.equal(operating(op,new Date('2026-10-26T17:00:00Z')).closed,false);
 assert.equal(operating(op,new Date('2026-10-26T18:00:00Z')).closed,true);
 assert.equal(operating({weeklyHours:{'2':[['00:00','00:00']]}},new Date('2026-10-26T18:00:00Z')).closed,false);
});
test('普通車と大型車は共用区画の全区画が空いている時だけ案内可能',()=>{
 const spaces=[{uid:'large',occupancyStatus:'available',isOccupied:false,sourceObject:{sharedGroup:'A'}},{uid:'small',occupancyStatus:'occupied',isOccupied:true,sourceObject:{sharedGroup:'A'}},{uid:'other',occupancyStatus:'available',isOccupied:false}];
 assert.equal(shared(spaces)[0].isOccupied,true);assert.equal(shared(spaces)[2].isOccupied,false);
 assert.equal(spaces[0].isOccupied,false);
 spaces[1].occupancyStatus='unknown';assert.equal(shared(spaces)[0].isOccupied,true);
 spaces[1].occupancyStatus='available';spaces[1].isOccupied=false;assert.equal(shared(spaces)[0].isOccupied,false);
});

test('開店60分前の境界から案内可能、実営業と案内可能を区別する',()=>{
 const op={weeklyHours:{'1':[['09:00','21:00']]}};
 assert.equal(operating(op,new Date('2026-10-25T22:59:59Z')).closed,true);
 const early=operating(op,new Date('2026-10-25T23:00:00Z'));
 assert.equal(early.closed,false);assert.equal(early.preOpening,true);assert.equal(early.isOpen,false);assert.equal(early.openingInMinutes,60);
 assert.equal(operating(op,new Date('2026-10-26T00:00:00Z')).preOpening,false);
 const close=operating(op,new Date('2026-10-26T11:00:00Z'));
 assert.equal(close.closingSoon,true);assert.equal(close.closingInMinutes,60);
 assert.equal(operating(op,new Date('2026-10-26T10:59:59Z')).closingSoon,false);
 assert.equal(operating(op,new Date('2026-10-26T12:00:00Z')).closed,true);
});
test('翌日の開店前・深夜の閉店通知・連続24時間営業を扱う',()=>{
 const early={weeklyHours:{'0':[],'1':[['00:30','03:00']]}};
 assert.equal(operating(early,new Date('2026-10-25T14:30:00Z')).preOpening,true);
 const night={weeklyHours:{'1':[['22:00','00:30']],'2':[]}};
 const before=operating(night,new Date('2026-10-26T14:30:00Z'));
 const after=operating(night,new Date('2026-10-26T15:01:00Z'));
 assert.equal(before.closingSoon,true);assert.equal(before.closingKey,after.closingKey);
 const all={weeklyHours:Object.fromEntries(Array.from({length:7},(_,d)=>[d,[['00:00','00:00']]]))};
 assert.equal(operating(all,new Date('2026-10-26T14:59:00Z')).closingSoon,false);
});
