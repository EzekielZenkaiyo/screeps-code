var CreepDesigner = require('../functions/creepDesigner')
import {Utils} from '../utils'

module.exports = {
  run: function(rooms: SODB, jobs: SODB, spawnQueue: SODB){
    var myRooms = <ObjectRoom[]>rooms.where({mine: true})

    _.forEach(myRooms, function(roomObject){
      var roomJobs = <ObjectJob[]>jobs.where({room: roomObject.name})

      var distroJobs = <DistroJob[]>jobs.refineSearch(roomJobs, {collect: 'distribute'})
      var harvestJobs = <HarvestJob[]>jobs.refineSearch(roomJobs, {collect: 'harvest'})
      var siteJobs = <ObjectJob[]>jobs.refineSearch(roomJobs, {act: 'build'})
      var extractJobs = <ObjectJob[]>jobs.refineSearch(roomJobs, {collect: 'extract'})
      var supplyJobs = <ObjectJob[]>jobs.refineSearch(roomJobs, {collect: 'supply'})
      var repairJobs = <ObjectJob[]>jobs.refineSearch(roomJobs, {act: 'repair'})
      var creepTypeJobs = <ObjectJob[]>jobs.refineSearch(roomJobs, {creepType: {defined: true}})

      if(supplyJobs.length > 0){
        var supplyCreeps = _.filter(Game.creeps, function(creep){
          return (creep.memory.collectFilter == 'supply' && creep.room.name == roomObject.name)
        })

        if(supplyCreeps.length == 0){
          spawnQueue.add({
            creepType: 'move',
            memory: {
              collectFilter: 'supply',
              actFilter: 'deliverResource'
            },
            priority: 40,
            spawned: false,
            room: roomObject.name
          })
        }
      }

      var totalWorkRate = 0
      _.forEach(harvestJobs, function(job){
        var creeps = Utils.findCreepsForJob(job)
        var workRate = Utils.workRate(creeps, 2)
        var source = <Source>Game.getObjectById(job.source)

        totalWorkRate += workRate

        if(workRate < (source.energyCapacity / 300)){
          if(!job.target || (job.target && workRate == 0)){
            spawnQueue.add(
              {
                creep: CreepDesigner.createCreep({
                  base: CreepDesigner.baseDesign.slowWork,
                  cap: CreepDesigner.caps.slowWork,
                  room: Game.rooms[roomObject.name]
                }),
                memory: {
                  jobHash: job.hash
                },
                priority: job.priority,
                spawned: false,
                room: roomObject.name
              }
            )
          }
        }
      })

      if(totalWorkRate == 0 && harvestJobs.length != 0){
        console.log(roomObject.name + ' emergancy harvester spawn')
        var entry = {
          creep: CreepDesigner.baseDesign.slowWork,
          memory: {
            jobHash: harvestJobs[0].hash
          },
          priority: 500,
          spawned: false,
          room: roomObject.name
        }

        spawnQueue.add(entry)
      }

      Memory.stats['room.' + roomObject.name + '.sourceWorkRate'] = totalWorkRate

      _.forEach(distroJobs, function(job){
        var creep = Utils.findCreepForJob(job)
        var creepsInRoom = _.filter(Game.creeps, function(cr){
          return (cr.room.name == roomObject.name && cr.memory.actFilter == 'deliver')
        })

        var container = <StructureContainer>Game.getObjectById(job.from)

        if(creepsInRoom.length == 0 && container.store.energy > 400){
          var canAffordOnly = true
        }else{
          var canAffordOnly = false
        }

        if(!creep){
          spawnQueue.add({
            creep: CreepDesigner.createCreep({
              base: CreepDesigner.baseDesign.move,
              cap: CreepDesigner.caps.move,
              room: Game.rooms[roomObject.name],
              canAffordOnly: canAffordOnly
            }),
            memory: {
              jobHash: job.hash,
              actFilter: 'deliver'
            },
            priority: 120,
            spawned: false,
            room: roomObject.name
          })
        }
      })

      if(siteJobs.length > 0){
        var numBuilders = _.min([(siteJobs.length / 10) + 1, 3])

        var builderCreeps = _.filter(Game.creeps, function(creep){
          return (creep.memory.actFilter == 'build' && creep.room.name == roomObject.name)
        })

        var siteJob = _.sortBy(siteJobs, 'priority').reverse()[0]

        if(builderCreeps.length < numBuilders && roomObject.generalContainers.length > 0 && roomObject.sourceContainers.length > 0){
          spawnQueue.add({
            creep: CreepDesigner.createCreep({
              base: CreepDesigner.baseDesign.fastWork,
              cap: CreepDesigner.caps.fastWork,
              room: Game.rooms[roomObject.name]
            }),
            memory: {
              jobHash: siteJob.hash,
              actFilter: 'build'
            },
            priority: siteJob.priority,
            spawned: false,
            room: roomObject.name
          })
        }
      }

      var upgraderCreeps = _.filter(Game.creeps, function(creep){
        return (creep.memory.actFilter == 'upgrade' && creep.room.name == roomObject.name)
      })

      Memory.stats['room.' + roomObject.name + '.upgradeRate'] = Utils.workRate(upgraderCreeps, 1)

      var upgraderCount = 2

      if(roomObject.rcl == 8){
        var upgraderCount = 1
      }

      if(roomObject.generalContainers.length == 0){
        var upgraderCount = 1
      }

      if(upgraderCreeps.length < upgraderCount && roomObject.recycleContainers.length > 0){
        var upgradeJob = <ObjectJob>jobs.refineSearch(roomJobs, {act: 'upgrade'})[0]

        spawnQueue.add({
          creepType: 'upgrader',
          memory: {
            jobHash: upgradeJob.hash,
            actFilter: 'upgrade'
          },
          priority: upgradeJob.priority,
          spawned: false,
          room: roomObject.name
        })
      }

      if(extractJobs.length > 0){
        _.forEach(extractJobs, function(job){
          var creep = Utils.findCreepForJob(job)

          if(!creep){
            spawnQueue.add({
              creep: CreepDesigner.createCreep({
                base: CreepDesigner.baseDesign.fastWork,
                cap: CreepDesigner.caps.fastWork,
                room: Game.rooms[roomObject.name]
              }),
              memory: {
                jobHash: job.hash
              },
              priority: job.priority,
              spawned: false,
              room: roomObject.name
            })
          }
        })
      }

      if(repairJobs.length > 0 && roomObject.rcl > 3){
        var repairCreeps = _.filter(Game.creeps, function(creep){
          return (creep.memory.actFilter == 'repair' && creep.room.name == roomObject.name)
        })

        if(repairCreeps.length < 1 && roomObject.generalContainers.length > 0){
          spawnQueue.add({
            creepType: 'fastWork',
            memory: {
              jobHash: repairJobs[0].hash,
              actFilter: 'repair'
            },
            priority: repairJobs[0].priority,
            spawned: false,
            room: roomObject.name
          })
        }
      }

      if(creepTypeJobs.length > 0){
        _.forEach(creepTypeJobs, function(job){
          let creeps = Utils.findCreepsForJob(job)

          if(creeps.length < job.creepCount!){
            spawnQueue.add({
              creepType: job.creepType,
              memory: {
                jobHash: job.hash
              },
              priority: job.priority,
              spawned: false,
              room: roomObject.name
            })
          }
        })
      }
    })
  }
}