var SODB = require('sodb')

var BuildingsController = require('./controllers/buildings')
var CreepsActor = require('./actors/creeps')
var CreepsController = require('./controllers/creeps')
var CreepDesigner = require('./functions/creepDesigner')
var Defcon = require('./functions/defcon')
var FlagObject = require('./objects/flag')
var FlagsController = require('./controllers/flags')
var JobsController = require('./controllers/jobs')
var LinksActor = require('./actors/links')
var ResourceController = require('./controllers/resources')
var RoomObject = require('./objects/room')
var SiteObject = require('./objects/site')
var Stats = require('./functions/stats')
var Utils = require('./utils')

if(global.lastTick && global.LastMemory && Game.time == (global.lastTick + 1)){
  delete global.Memory
  global.Memory = global.LastMemory
  RawMemory._parsed = global.LastMemory
}else{
  Memory;
  global.lastMemory = RawMemory._parsed
  global.lastTick = Game.time
}

if(!Memory.jobPremades){
  Memory.jobPremades = {}
}

// Create an empty state if none exists
if(!Memory.state){
  Memory.state = {}
  Memory.stateCheck = 'new'
}

var profiler = {}

// Clear dead creeps from memory
for(var name in Memory.creeps){
  if(!Game.creeps[name]){
    delete Memory.creeps[name]
    for(var rm in Memory.arc){
      Memory.arc[rm].newCreep = true
    }
    console.log('Clearing non-existing creep memory:', name);
  }
}

// Get the total of all rcls added together (for state change on RCL up)
var rclTotal = 0
_.forEach(Game.rooms, function(room){
  if(room.controller){
    if(room.controller.my){
      rclTotal += room.controller.level
    }
  }
})
// Use object-hash to check if anything in the game has changed
var hashCheck = {
  codeRevision: 0,
  rooms: Object.keys(Game.rooms).length,
  creeps: Object.keys(Game.creeps).length,
  spawns: Object.keys(Game.spawns).length,
  structures: Object.keys(Game.structures).length,
  sites: Object.keys(Game.constructionSites).length,
  rclTotal: rclTotal,
  flags: Object.keys(Game.flags).length
}

var newHash = Utils.hash(hashCheck)

if(Memory.stateCheck != newHash){
  console.log('============ New Game State ============')
  console.log(newHash)
  Memory.stats['gameState'] = 100
  // The Game state has changed, need to rebuild objects

  // Store the new hash in Memory
  Memory.stateCheck = newHash

  // Create the SODBs
  var rooms = new SODB({cache: true})
  var jobs = new SODB({cache: true})
  var sites = new SODB({cache: true})
  var flags = new SODB({cache: true})

  _.forEach(Game.flags, function(flag){
    var flagObject = FlagObject(flag)

    flags.add(flagObject)
  })

  // Build data
  for(var roomName in Game.rooms){
    var roomObject = RoomObject(Game.rooms[roomName])
    rooms.add(roomObject)

    JobsController.jobsForRoom(roomObject, jobs)
  }

  _.forEach(Game.constructionSites, function(site){
    var siteObject = SiteObject(site)

    sites.add(siteObject)
  })

  var dbRevisions = {
    rooms: -1,
    jobs: -1,
    sites: -1,
    flags: -1
  }
}else{
  Memory.stats['gameState'] = 0
  // The Game state has not changed, restore the objects
  //var rooms = SODB.buildFromJSON(Memory.state.rooms, {cache: true})

  var rooms = new SODB({cache: true})
  rooms.objects = Memory.state.roomObjects
  rooms.cache.cache = Memory.state.roomCache

  //var jobs = SODB.buildFromJSON(Memory.state.jobs, {cache: true})
  var jobs = new SODB({cache: true})
  //jobs.objects = Memory.state.jobObjects

  _.forEach(Memory.state.jobObjects, function(entry){
    if(entry != null){
      jobs.objects[entry.___id] = entry
    }
  })

  jobs.lastInsertId = Memory.state.jobLastInsert

  jobs.cache.cache = Memory.state.jobCache
  jobs.dbRevision = Memory.state.jobDbRevision

  //var sites = SODB.buildFromJSON(Memory.state.sites, {cache: true})
  var sites = new SODB({cache: true})
  sites.objects = Memory.state.siteObjects
  sites.cache.cache = Memory.state.siteCache

  //var flags = SODB.buildFromJSON(Memory.state.flags, {cache: true})
  var flags = new SODB({cache: true})
  flags.objects = Memory.state.flagObjects
  flags.cache.cache = Memory.state.flagCache

  var dbRevisions = {
    rooms: rooms.dbRevision,
    jobs: jobs.dbRevision,
    sites: sites.dbRevision,
    flags: flags.dbRevision
  }
}

var spawnQueue = new SODB()

profiler.prepare = Game.cpu.getUsed()

// Add dynamic jobs
JobsController.energyJobs(rooms, jobs)
JobsController.siteJobs(sites, jobs)
JobsController.extractorJobs(rooms, jobs)

profiler.jobsController = Game.cpu.getUsed() - profiler.prepare

// Run the Buildings Controller
BuildingsController.run(rooms, jobs, flags)

profiler.buildingsController = Game.cpu.getUsed() - _.sum(profiler)

// Run the flags Controller
FlagsController.run(rooms, jobs, flags, spawnQueue)

profiler.flagsController = Game.cpu.getUsed() - _.sum(profiler)

// Run the Creeps Controller
CreepsController.run(rooms, jobs, spawnQueue)

profiler.creepsController = Game.cpu.getUsed() - _.sum(profiler)

ResourceController.run(rooms, jobs)

profiler.resourceController = Game.cpu.getUsed() - _.sum(profiler)

// Set room Defcon Levels
Defcon.run(rooms)

profiler.defcon = Game.cpu.getUsed() - _.sum(profiler)

// Run creep actions
CreepsActor.run(rooms, jobs)

profiler.creepsActor = Game.cpu.getUsed() - _.sum(profiler)

LinksActor.run(rooms)

// Process the spawn queue
for(var roomName in Game.rooms){
  var room = rooms.findOne({name: roomName})
  var spawns = Utils.inflate(room.spawns)

  _.forEach(spawns, function(spawn){
    if(!spawn.spawning){
      var queue = spawnQueue.order({room: roomName}, {spawned: false}, 'priority').reverse()[0]

      if(queue){
        if(queue.creepType){
          console.log('Designing ' + queue.creepType + ' for ' + roomName)
          if(CreepDesigner.extend[queue.creepType]){
            var extend = CreepDesigner.extend[queue.creepType]
          }else{
            var extend =CreepDesigner.baseDesign[queue.creepType]
          }
          var creep = CreepDesigner.createCreep({
            base: CreepDesigner.baseDesign[queue.creepType],
            cap: CreepDesigner.caps[queue.creepType],
            room: Game.rooms[roomName],
            extend: extend
          })
        }else{
          var creep = queue.creep
        }

        var canCreate = spawn.canCreateCreep(creep)

        if(canCreate == ERR_NOT_ENOUGH_ENERGY && queue.room == 'E65S72'){
          console.log('=== NOT ENOUGH ENERGY ===')
          console.log(queue.room)
          console.log(JSON.stringify(creep))
          console.log(CreepDesigner.creepCost(creep))
          console.log(JSON.stringify(queue.memory))
          console.log(spawnQueue.where({room: roomName}, {spawned: false}).length)
        }

        spawn.createCreep(creep, undefined, queue.memory)

        queue.spawned = true

        spawnQueue.update(queue)
      }
    }
  })
}

profiler.spawnQueue = Game.cpu.getUsed() - _.sum(profiler)


// End of the loop, store objects in game state
if(dbRevisions.rooms != rooms.dbRevision){
  Memory.state.roomObjects = rooms.objects
  Memory.state.roomCache = rooms.cache.cache
}
if(dbRevisions.jobs != jobs.dbRevision){
  Memory.state.jobObjects = jobs.objects
  //Memory.state.jobCache = jobs.cache.cache
  Memory.state.jobLastInsert = jobs.lastInsertId
  Memory.state.jobDbRevision = jobs.dbRevision
}
if(dbRevisions.sites != sites.dbRevision){
  Memory.state.siteObjects = sites.objects
  Memory.state.siteCache = sites.cache.cache
}
if(dbRevisions.flags != flags.dbRevision){
  Memory.state.flagObjects = flags.objects
  Memory.state.flagCache = flags.cache.cache
}

Memory.stats['profile.serialization'] = Game.cpu.getUsed() - _.sum(profiler)

Memory.stats['profile.prepare'] = profiler.prepare
Memory.stats['profile.JobsController'] = profiler.jobsController
Memory.stats['profile.buildingsController'] = profiler.buildingsController
Memory.stats['profile.flagsController'] = profiler.flagsController
Memory.stats['profile.creepsController'] = profiler.creepsController
Memory.stats['profile.resourceController'] = profiler.resourceController
Memory.stats['profile.defcon'] = profiler.defcon
Memory.stats['profile.creepsActor'] = profiler.creepsActor
Memory.stats['profile.spawnQueue'] = profiler.spawnQueue

Stats.run(rooms, jobs, sites, flags)